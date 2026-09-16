<script setup>
import { ref, computed, onMounted, nextTick, watch, onUnmounted } from 'vue'
import { supabase } from './supabase'
import { initAudio, playShutter, playSuccess, playFailure, playGameOver as _playGameOver } from './audio'
import RulesModal from './components/RulesModal.vue'
import HowToPlayModal from './components/HowToPlayModal.vue'
import ReportModal from './components/ReportModal.vue'
import PrivacyPolicyModal from './components/PrivacyPolicyModal.vue'
import AdminPanel from './components/AdminPanel.vue'

const isAdminMode = computed(() => {
  const urlParams = new URLSearchParams(window.location.search)
  return urlParams.has('admin')
})

const showRulesModal = ref(false)
const showHowToPlayModal = ref(false)
const showPrivacyPolicyModal = ref(false)
const showReportModal = ref(false)
const reportTarget = ref(null)
const showCameraWarning = ref(false)

// Global State
const currentMode = ref('join') // 'join', 'lobby', 'play', 'history'
const roomId = ref(null)
const roomStatus = ref('waiting')
const hostId = ref(null)
const roomShareEnabled = ref(false)
const hasPlayedGameOverSound = ref(false)
const isJoining = ref(false)
const isAgreed = ref(false)
const isPrivacyAgreed = ref(false)
const isPublicRoom = ref(false)

const playGameOver = () => {
  if (hasPlayedGameOverSound.value) return
  hasPlayedGameOverSound.value = true
  _playGameOver()
}

// Player State
const playerId = ref('')
const playerName = ref('')
const playersList = ref([])
const currentTurnIndex = ref(0)
const isImageShareEnabled = ref(false)
const difficulty = ref('normal')
const roomDifficulty = ref('normal')
const initialHp = ref(3)
const maxPlayers = ref(5)
const roomMaxPlayers = ref(5)

// Game State
const targetLetter = ref('あ')
const currentState = ref('initial')
const isProcessingGameOver = ref(false)
const chatData = ref({
  text: '準備中...✨',
  image: null
})
const wordAnimationData = ref(null)
const triggerWordAnimation = (word, reading) => {
  wordAnimationData.value = { word, reading }
  setTimeout(() => {
    if (wordAnimationData.value?.word === word) {
      wordAnimationData.value = null
    }
  }, 2500)
}
const turnCount = ref(0)
const latestMyWord = ref('')
const gameOverData = ref(null)
const historyList = ref([])
const selectedImage = ref(null)

// Camera State
const videoRef = ref(null)
const canvasRef = ref(null)
const stream = ref(null)
const capturedImage = ref(null)

const hiraganaList = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわو".split('')

// Computed
const activePlayer = computed(() => {
  if (playersList.value.length === 0) return null
  return playersList.value[currentTurnIndex.value % playersList.value.length]
})

const myPlayer = computed(() => {
  return playersList.value.find(p => p.id === playerId.value)
})

const isMyTurn = computed(() => {
  return activePlayer.value?.id === playerId.value
})

const isHost = computed(() => {
  return hostId.value === playerId.value
})

// Realtime channels and Turn timeout
const activeChannels = []
let turnTimeout = null

const cleanupSubscriptions = async () => {
  isCleaningUp = true
  for (const channel of activeChannels) {
    await supabase.removeChannel(channel)
  }
  activeChannels.length = 0
  isCleaningUp = false
}

const startTurnTimeout = () => {
  clearTimeout(turnTimeout)
  if (currentMode.value === 'play' && currentState.value === 'initial' && activePlayer.value) {
    turnTimeout = setTimeout(async () => {
      if (currentMode.value === 'play' && currentState.value === 'initial' && activePlayer.value) {
        if (isMyTurn.value) {
          alert('60秒経過のため、強制パスします！')
          passMyTurn()
        } else {
          // ゴースト対策：他の生きているプレイヤーが代理でパス処理を行う
          const myPlayerInfo = playersList.value.find(p => p.id === playerId.value)
          if (myPlayerInfo && myPlayerInfo.hp > 0) {
            const expectedHp = activePlayer.value.hp
            const newHp = Math.max(0, expectedHp - 1)
            const expectedTurn = currentTurnIndex.value
            
            const hpSuccess = await safeUpdatePlayerHp(activePlayer.value.id, expectedHp, newHp, roomId.value)
            if (hpSuccess) {
              const targetPlayerInList = playersList.value.find(p => p.id === activePlayer.value.id)
              if (targetPlayerInList) targetPlayerInList.hp = newHp

              let isOver = false
              if (newHp <= 0) {
                isOver = await checkWinCondition()
              }
              
              if (!isOver) {
                await safeUpdateRoomTurn(roomId.value, expectedTurn, getNextTurnIndex(expectedTurn), targetLetter.value)
              }
            }
          }
        }
      }
    }, 60000)
  }
}

watch([currentTurnIndex, currentState, isMyTurn], () => {
  startTurnTimeout()
})

const isRecovering = ref(false)

const recoverGameState = async (id) => {
  await fetchRoomData(id)
  if (!hostId.value) return false // Room not found

  const myPlayer = playersList.value.find(p => p.id === playerId.value)
  if (!myPlayer) return false // Not in room

  setupRealtimeSubscription(id)

  if (roomStatus.value === 'playing') {
    currentMode.value = 'play'
    startCamera()
  } else if (roomStatus.value === 'gameover' || roomStatus.value === 'clear') {
    currentMode.value = 'play'
    const { data: lastWord } = await supabase.from('words').select('*').eq('room_id', id).order('created_at', { ascending: false }).limit(1).single()
    if (lastWord) {
      gameOverData.value = {
        word: lastWord.detected_word,
        reading: lastWord.reading,
        comment: lastWord.comment,
        image: lastWord.image_base64,
        wordId: lastWord.id
      }
    }
    currentState.value = roomStatus.value
  } else {
    currentMode.value = 'lobby'
    startHeartbeat()
  }
  return true
}

onMounted(async () => {
  let storedId = localStorage.getItem('shiritori_player_id')
  if (!storedId) {
    storedId = crypto.randomUUID()
    localStorage.setItem('shiritori_player_id', storedId)
  }
  playerId.value = storedId

  let storedName = localStorage.getItem('shiritori_player_name')
  if (storedName) {
    playerName.value = storedName
  }

  const params = new URLSearchParams(window.location.search)
  const room = params.get('room')
  if (room) {
    roomId.value = room
    isRecovering.value = true
    
    // 自分がすでに部屋にいるか確認
    await fetchRoomData(room)
    const isAlreadyInRoom = playersList.value.some(p => p.id === playerId.value)

    if (isAlreadyInRoom) {
      const success = await recoverGameState(room)
      if (!success) {
        alert('部屋に復帰できませんでした（退出済みか満室です）💦')
        roomId.value = null
        window.history.replaceState({}, '', '/')
        currentMode.value = 'join'
      }
    } else {
      currentMode.value = 'join'
    }
    isRecovering.value = false
  } else {
    currentMode.value = 'join'
  }
  
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('popstate', handleBeforeUnload)
  window.addEventListener('offline', handleOffline)
  window.addEventListener('online', handleOnline)
})

const handleOffline = () => {
  isRealtimeConnected.value = false
  triggerReconnect()
}
const handleOnline = () => {
  triggerReconnect(true)
}

let heartbeatInterval = null
const startHeartbeat = () => {
  if (heartbeatInterval) clearInterval(heartbeatInterval)
  heartbeatInterval = setInterval(() => {
    supabase.from('players').update({ last_seen_at: new Date().toISOString() }).eq('id', playerId.value).then()
  }, 15000)
}

const isRealtimeConnected = ref(true)
const isReconnecting = ref(false)
let reconnectTimer = null
let reconnectAttempts = 0
let isCleaningUp = false

const triggerReconnect = (immediate = false) => {
  if (!roomId.value || currentMode.value === 'join' || currentMode.value === 'history') return
  if (isReconnecting.value && !immediate) return
  if (isCleaningUp) return

  isReconnecting.value = true
  isRealtimeConnected.value = false
  if (reconnectTimer) clearTimeout(reconnectTimer)

  const delay = immediate ? 0 : Math.min(1000 * Math.pow(2, reconnectAttempts), 10000)
  
  reconnectTimer = setTimeout(async () => {
    try {
      if (!window.navigator.onLine) {
        reconnectAttempts++
        isReconnecting.value = false
        triggerReconnect()
        return
      }

      await cleanupSubscriptions()
      setupRealtimeSubscription(roomId.value)
      await recoverGameState(roomId.value) // This handles fetching and updating UI state
      
      reconnectAttempts = 0
    } catch (e) {
      console.error('Reconnect error:', e)
      reconnectAttempts++
      isReconnecting.value = false
      triggerReconnect()
    }
  }, delay)
}

watch(currentMode, (newMode) => {
  if (newMode === 'lobby') {
    startHeartbeat()
  } else {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
      heartbeatInterval = null
    }
  }
})


watch([currentMode, currentState], ([newMode, newState]) => {
  if (newMode === 'play' && newState === 'initial') {
    const hasSeen = localStorage.getItem('shiritori_camera_warning_shown')
    if (!hasSeen) {
      showCameraWarning.value = true
      setTimeout(() => {
        showCameraWarning.value = false
      }, 6000)
      localStorage.setItem('shiritori_camera_warning_shown', '1')
    }
  }
})

const openReport = (targetPlayerId, targetWordId = null) => {
  if (targetPlayerId === playerId.value) return
  reportTarget.value = { playerId: targetPlayerId, wordId: targetWordId }
  showReportModal.value = true
}

const handleReportSubmit = async (reason) => {
  showReportModal.value = false
  if (!reportTarget.value) return
  try {
    const { error } = await supabase.from('reports').insert({
      room_id: roomId.value,
      reporter_id: playerId.value,
      target_player_id: reportTarget.value.playerId,
      target_word_id: reportTarget.value.wordId,
      reason: reason
    })
    if (error) throw error
    alert('報告を受け付けました。ご協力ありがとうございます🙇‍♂️')
  } catch (e) {
    console.error('Report error:', e)
    alert('報告の送信に失敗しました💦')
  }
}
const leaveLobby = async () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
  if (currentMode.value === 'lobby' && roomStatus.value === 'waiting' && playerId.value) {
    // 物理削除は外部キー制約エラーになるため、room_idをnullにして退出扱いにする
    await supabase.from('players').update({ room_id: null, is_ready: false }).eq('id', playerId.value)
  }
}

const handleBeforeUnload = (e) => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
  if (currentMode.value === 'lobby' && roomStatus.value === 'waiting' && playerId.value) {
    // navigator.sendBeacon fallback isn't perfectly reliable with Supabase client, 
    // but we can fire a fire-and-forget update.
    supabase.from('players').update({ room_id: null, is_ready: false }).eq('id', playerId.value).then()
  }
}

onUnmounted(async () => {
  if (heartbeatInterval) clearInterval(heartbeatInterval)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('popstate', handleBeforeUnload)
  window.removeEventListener('offline', handleOffline)
  window.removeEventListener('online', handleOnline)
  await leaveLobby()
  clearTimeout(turnTimeout)
  await cleanupSubscriptions()
  if (stream.value) {
    stream.value.getTracks().forEach(track => track.stop())
  }
})

// --- Join & Lobby Logic ---
const sanitizeAndValidateName = (name) => {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 15) {
    alert('プレイヤー名は1〜15文字で入力してください。')
    return null
  }
  
  // URLやメアドらしき文字列をブロック
  const urlRegex = /https?:\/\/[^\s]+/i
  const emailRegex = /[^\s@]+@[^\s@]+\.[^\s@]+/i
  if (urlRegex.test(trimmed) || emailRegex.test(trimmed)) {
    alert('URLやメールアドレスを含む名前は使用できません。')
    return null
  }
  
  // 基本的なXSS対策（HTMLタグをエスケープ）
  const sanitized = trimmed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    
  return sanitized
}
const joinRandomRoom = async () => {
  if (isJoining.value) return
  isJoining.value = true
  
  try {
    initAudio()
    const validName = sanitizeAndValidateName(playerName.value)
    if (!validName) {
      isJoining.value = false
      return
    }
    playerName.value = validName
    localStorage.setItem('shiritori_player_name', playerName.value)
    
    // 中級、HP3固定
    difficulty.value = 'normal'
    initialHp.value = 3
    isImageShareEnabled.value = false // パブリックは画像共有オフ推奨

    const randomChar = hiraganaList[Math.floor(Math.random() * hiraganaList.length)]
    
    const { data: newRoomId, error } = await supabase.rpc('find_or_create_public_room', {
      p_player_id: playerId.value,
      p_name: String(playerName.value),
      p_hp: 3,
      p_difficulty: 'normal',
      p_random_char: randomChar,
      p_max_players: 5
    })

    if (error || !newRoomId) {
      console.error('Random match error:', error)
      alert('マッチングに失敗しました💦')
      return
    }

    roomId.value = newRoomId
    localStorage.setItem('shiritori_player_id', playerId.value)
    
    await fetchRoomData(newRoomId)
    
    window.history.pushState({}, '', `/?room=${newRoomId}`)
    setupRealtimeSubscription(newRoomId)
    currentMode.value = 'lobby'
  } catch (error) {
    console.error('Random match error:', error)
  } finally {
    isJoining.value = false
  }
}

const joinOrCreateRoom = async () => {
  if (isJoining.value) return
  isJoining.value = true
  
  try {
    initAudio()
    const validName = sanitizeAndValidateName(playerName.value)
    if (!validName) {
      isJoining.value = false
      return
    }
    playerName.value = validName
    localStorage.setItem('shiritori_player_name', playerName.value)
    
    if (roomId.value) {
      // Join existing room
      await fetchRoomData(roomId.value)
      if (!hostId.value) {
        alert('部屋が見つかりません😢')
        return
      }
      
      // Check if already in room
      let myPlayer = playersList.value.find(p => p.id === playerId.value)
      if (!myPlayer) {
        const { data: joined, error: pError } = await supabase.rpc('join_room', {
          p_room_id: roomId.value,
          p_player_id: playerId.value,
          p_name: String(playerName.value),
          p_hp: Number(initialHp.value)
        })
        if (pError || !joined) {
          console.error('Player insert error:', pError)
          alert('満室または参加エラーが発生しました💦')
          return
        }
        
        localStorage.setItem('shiritori_player_id', playerId.value)
        
        // ユーザー指示: 再度 SELECT を行い自身のプレイヤー情報を取得しローカルにセット
        const { data: fetchedPlayer, error: fetchErr } = await supabase.from('players').select('*').eq('id', playerId.value).single()
        if (fetchErr) {
          console.error('Player fetch error:', fetchErr)
        } else if (fetchedPlayer) {
          playersList.value.push(fetchedPlayer)
        }
        
        // Refetch to get the updated list and order
        await fetchRoomData(roomId.value)
      }
      setupRealtimeSubscription(roomId.value)
      currentMode.value = roomStatus.value === 'playing' ? 'play' : 'lobby'
      if (currentMode.value === 'play') startCamera()
    } else {
      // Create new room (Host)
      const randomChar = hiraganaList[Math.floor(Math.random() * hiraganaList.length)]
      const newRoomId = crypto.randomUUID()
      
      const { data: newRoom, error } = await supabase.from('rooms').insert([{ 
        id: newRoomId,
        current_char: randomChar,
        is_image_share_enabled: Boolean(isImageShareEnabled.value),
        status: 'waiting',
        current_turn_index: 0,
        host_id: playerId.value,
        difficulty: String(difficulty.value),
        initial_hp: Number(initialHp.value),
        max_players: Number(maxPlayers.value)
      }]).select().single()

      if (error || !newRoom) {
        console.error('Room creation error:', error)
        alert('部屋の作成に失敗しました😢')
        return
      }

      const { data: joined, error: pError } = await supabase.rpc('join_room', {
        p_room_id: newRoom.id,
        p_player_id: playerId.value,
        p_name: String(playerName.value),
        p_hp: Number(newRoom.initial_hp || initialHp.value)
      })
      
      if (pError || !joined) {
        console.error('Player insert error:', pError)
        alert('プレイヤー作成に失敗しました😢')
        return
      }

      const { data: fetchedPlayer, error: fetchErr } = await supabase.from('players').select('*').eq('id', playerId.value).single()
      if (fetchErr) {
        console.error('Player fetch error:', fetchErr)
      } else if (fetchedPlayer) {
        playersList.value = [fetchedPlayer]
      }

      roomId.value = newRoom.id
      localStorage.setItem('shiritori_player_id', playerId.value)
      hostId.value = playerId.value
      roomStatus.value = 'waiting'
      targetLetter.value = newRoom.current_char
      roomShareEnabled.value = newRoom.is_image_share_enabled
      roomDifficulty.value = newRoom.difficulty || difficulty.value
      initialHp.value = newRoom.initial_hp || initialHp.value
      chatData.value = { text: `さあ、何撮るの？ はやく『${targetLetter.value}』から始まるもの見つけてよ😏`, image: null }

      await fetchRoomData(newRoom.id)

      window.history.pushState({}, '', `/?room=${newRoom.id}`)
      setupRealtimeSubscription(newRoom.id)
      currentMode.value = 'lobby'
    }
  } catch (error) {
    console.error('Join room error:', error)
  } finally {
    isJoining.value = false
  }
}

const startGame = async () => {
  initAudio()
  if (!isHost.value && !isPublicRoom.value) return
  if (roomStatus.value === 'playing') return
  
  const statusSuccess = await safeUpdateRoomStatus(roomId.value, 'waiting', 'playing')
  if (statusSuccess) {
    roomStatus.value = 'playing'
  }
}

const countdownTime = ref(null)
let countdownInterval = null

const toggleReady = async () => {
  if (!myPlayer.value) return
  initAudio()
  const newReadyState = !myPlayer.value.is_ready
  // Optimistic UI update
  myPlayer.value.is_ready = newReadyState
  
  const { error } = await supabase
    .from('players')
    .update({ is_ready: newReadyState, room_id: roomId.value })
    .eq('id', playerId.value)
    
  if (error) {
    console.error('Failed to toggle ready state:', error)
    // Revert optimistic update on error
    myPlayer.value.is_ready = !newReadyState
  }
}

watch(playersList, (newList) => {
  if (currentMode.value !== 'lobby' || roomStatus.value !== 'waiting' || !isPublicRoom.value) return

  const validPlayers = newList.filter(p => (p.hp || 0) > 0)
  const readyPlayers = validPlayers.filter(p => p.is_ready)
  const readyCount = readyPlayers.length
  const totalCount = validPlayers.length

  if (readyCount >= 2 && readyCount === totalCount) {
    // 全員準備完了 -> 即時スタート
    if (countdownInterval) {
      clearInterval(countdownInterval)
      countdownInterval = null
    }
    countdownTime.value = null
    startGame()
  } else if (readyCount >= 2 && readyCount < totalCount) {
    // 2人以上準備完了だが未準備がいる -> 15秒カウントダウン
    if (!countdownInterval) {
      countdownTime.value = 15
      countdownInterval = setInterval(() => {
        if (countdownTime.value > 0) {
          countdownTime.value--
        } else {
          clearInterval(countdownInterval)
          countdownInterval = null
          countdownTime.value = null
          startGame()
        }
      }, 1000)
    }
  } else {
    // 2人未満 -> キャンセル
    if (countdownInterval) {
      clearInterval(countdownInterval)
      countdownInterval = null
    }
    countdownTime.value = null
  }
}, { deep: true })

const shareRoomLink = async () => {
  const url = `${window.location.origin}/?room=${roomId.value}`
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'レンズしりとりオンライン',
        text: '一緒に写真しりとりをしよう！',
        url: url
      })
    } catch (err) {
      console.error('Share failed:', err)
    }
  } else {
    try {
      await navigator.clipboard.writeText(url)
      alert('招待リンクをコピーしました！🔗')
    } catch (err) {
      alert('リンクのコピーに失敗しました💦')
    }
  }
}

// --- Optimistic Update Helpers ---
const safeUpdateRoomTurn = async (id, expectedIndex, newIndex, nextChar) => {
  const { data: success, error } = await supabase.rpc('update_room_turn_optimistic', {
    p_room_id: id,
    p_expected_turn_index: expectedIndex,
    p_new_turn_index: newIndex,
    p_next_char: nextChar
  })
  if (error) {
    console.error('update_room_turn_optimistic RPC error:', { error, p_room_id: id, p_expected: expectedIndex, p_new: newIndex })
    await fetchRoomData(id)
    return false
  }
  if (!success) {
    console.warn('Turn update rejected (conflict). Syncing state...')
    await fetchRoomData(id)
    return false
  }
  return true
}

const safeUpdatePlayerHp = async (pId, expectedHp, newHp, rId) => {
  const { data: success, error } = await supabase.rpc('update_player_hp_optimistic', {
    p_player_id: pId,
    p_expected_hp: expectedHp,
    p_new_hp: newHp
  })
  if (error) {
    console.error('update_player_hp_optimistic RPC error:', { error, p_player_id: pId, p_expected: expectedHp, p_new: newHp })
    await fetchRoomData(rId)
    return false
  }
  if (!success) {
    console.warn('HP update rejected (conflict). Syncing state...')
    await fetchRoomData(rId)
    return false
  }
  return true
}

const safeUpdateRoomStatus = async (id, expectedStatus, newStatus) => {
  const { data: success, error } = await supabase.rpc('update_room_status_optimistic', {
    p_room_id: id,
    p_expected_status: expectedStatus,
    p_new_status: newStatus
  })
  if (error) {
    console.error('update_room_status_optimistic RPC error:', { error, p_room_id: id, p_expected: expectedStatus, p_new: newStatus })
    await fetchRoomData(id)
    return false
  }
  if (!success) {
    console.warn('Status update rejected (conflict). Syncing state...')
    await fetchRoomData(id)
    return false
  }
  return true
}

// --- Data Fetch & Realtime ---
const fetchRoomData = async (id) => {
  const { data: roomData } = await supabase.from('rooms').select('*').eq('id', id).single()
  if (roomData) {
    hostId.value = roomData.host_id
    roomStatus.value = roomData.status
    targetLetter.value = roomData.current_char || 'あ'
    currentTurnIndex.value = roomData.current_turn_index || 0
    roomShareEnabled.value = !!roomData.is_image_share_enabled
    isPublicRoom.value = !!roomData.is_public
    roomDifficulty.value = roomData.difficulty || 'normal'
    initialHp.value = roomData.initial_hp || 3
    roomMaxPlayers.value = roomData.max_players || 5
    chatData.value = { text: `さあ、何撮る？まずは『${targetLetter.value}』から始まるもの見つけてよ😁`, image: null }
  }

  const { data: playersData } = await supabase.from('players').select('*').eq('room_id', id).order('order_index')
  if (playersData) {
    playersList.value = playersData
  }

  const { count } = await supabase.from('words').select('*', { count: 'exact', head: true }).eq('room_id', id)
  turnCount.value = count || 0
}

const setupRealtimeSubscription = (id) => {
  const handleStatus = (status) => {
    if (isCleaningUp) return
    if (status === 'SUBSCRIBED') {
      isRealtimeConnected.value = true
      isReconnecting.value = false
      reconnectAttempts = 0
    } else if (['CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
      triggerReconnect()
    }
  }

  // Listen to Rooms (変数 roomChannel に格納)
  const roomChannel = supabase.channel(`rooms-${id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` }, async (payload) => {
    const room = payload.new
    
    // Status change
    if (room.status === 'playing') {
      if (currentMode.value === 'lobby') {
        currentMode.value = 'play'
        startCamera()
      } else if (currentState.value === 'gameover' || currentState.value === 'clear') {
        currentMode.value = 'play'
        turnCount.value = 0
        targetLetter.value = room.current_char || 'あ'
        currentState.value = 'initial'
        isProcessingGameOver.value = false
        hasPlayedGameOverSound.value = false
        chatData.value = { text: `レディー・ゴー！まずは「${targetLetter.value}」から始まる言葉を見つけてね🔍`, image: null }
        capturedImage.value = null
        if (videoRef.value) videoRef.value.play()
        else startCamera()
      }
    } else if (room.status === 'gameover' && !isProcessingGameOver.value) {
      isProcessingGameOver.value = true
      // Sync game over state for those who didn't trigger it
      const { data: lastWord } = await supabase.from('words').select('*').eq('room_id', id).order('created_at', { ascending: false }).limit(1).single()
      if (lastWord) {
        gameOverData.value = {
          word: lastWord.detected_word,
          reading: lastWord.reading,
          comment: lastWord.comment,
          image: lastWord.image_base64
        }
        if (lastWord.detected_word === '引き分け' || lastWord.detected_word === '優勝') {
          playSuccess()
        } else {
          playGameOver()
        }
      } else {
        playGameOver()
      }
      currentState.value = 'gameover'
    }

    currentTurnIndex.value = room.current_turn_index
    targetLetter.value = room.current_char || targetLetter.value
  }).subscribe(handleStatus)

  // Listen to Players (変数 playerChannel に格納)
  const playerChannel = supabase.channel(`players-${id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, (payload) => {
    if (payload.eventType === 'INSERT') {
      if (payload.new.room_id === id && !playersList.value.find(p => p.id === payload.new.id)) {
        playersList.value.push(payload.new)
        playersList.value.sort((a, b) => a.order_index - b.order_index)
      }
    } else if (payload.eventType === 'UPDATE') {
      const idx = playersList.value.findIndex(p => p.id === payload.new.id)
      
      // If room_id is explicitly set to something else (e.g., null when leaving)
      if (payload.new.room_id !== undefined && payload.new.room_id !== id) {
        if (idx !== -1) playersList.value.splice(idx, 1)
        return
      }

      if (idx !== -1) {
        // Merge to preserve fields that Postgres optimized out from the payload
        const updatedPlayer = { ...playersList.value[idx], ...payload.new }
        playersList.value.splice(idx, 1, updatedPlayer)
      } else if (payload.new.room_id === id) {
        playersList.value.push(payload.new)
        playersList.value.sort((a, b) => a.order_index - b.order_index)
      }
    } else if (payload.eventType === 'DELETE') {
      const idx = playersList.value.findIndex(p => p.id === payload.old.id)
      if (idx !== -1) playersList.value.splice(idx, 1)
    }
  }).subscribe(handleStatus)

  // Listen to Words (変数 wordChannel に格納)
  const wordChannel = supabase.channel(`words-${id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'words', filter: `room_id=eq.${id}` }, (payload) => {
    const word = payload.new
    if (word.detected_word === latestMyWord.value) {
      latestMyWord.value = '' // clear
    } else {
      // Ignore system words and words that end the game (handled by room listener)
      if (['全滅', '優勝', '引き分け'].includes(word.detected_word) || word.next_char === 'ん') {
        return
      }

      // Skip if game is already over
      if (isProcessingGameOver.value || currentState.value === 'gameover') {
        return
      }

      // It's someone else's word
      turnCount.value++
      targetLetter.value = word.next_char
      
      const playerName = getPlayerName(word.player_id) || '友達'
      chatData.value = {
        text: `👤${playerName}: 『${word.detected_word}』📸\n${word.comment || '判定成功！次へ繋ぎます✨'}`,
        image: word.image_base64 || null,
        playerId: word.player_id,
        wordId: word.id
      }
      triggerWordAnimation(word.detected_word, word.reading)
      currentState.value = 'initial'
      capturedImage.value = null
      if (videoRef.value && isMyTurn.value) videoRef.value.play()
    }
  }).subscribe(handleStatus)

  const presenceChannel = supabase.channel(`presence-${id}`, {
    config: {
      presence: {
        key: playerId.value
      }
    }
  })

  presenceChannel.on('presence', { event: 'sync' }, () => {
    if (roomStatus.value !== 'waiting') return

    const presenceState = presenceChannel.presenceState()
    const onlineIds = Object.keys(presenceState)

    playersList.value.forEach(p => {
      if (!onlineIds.includes(p.id)) {
        setTimeout(() => {
          const currentState = presenceChannel.presenceState()
          const currentOnlineIds = Object.keys(currentState)
          if (!currentOnlineIds.includes(p.id)) {
            // Found a ghost -> set room_id to null and manually remove from UI
            supabase.from('players').update({ room_id: null, is_ready: false }).eq('id', p.id).then()
            playersList.value = playersList.value.filter(player => player.id !== p.id)
          }
        }, 3000)
      }
    })
  }).subscribe(async (status) => {
    handleStatus(status)
    if (status === 'SUBSCRIBED') {
      await presenceChannel.track({ id: playerId.value })
    }
  })

  activeChannels.push(roomChannel, playerChannel, wordChannel, presenceChannel)
}

// --- Gameplay Logic ---
const getNextTurnIndex = (currentIndex) => {
  const numPlayers = playersList.value.length;
  if (numPlayers === 0) return currentIndex + 1;
  let nextIndex = currentIndex + 1;
  for(let i=0; i<numPlayers; i++) {
    const playerToCheck = playersList.value[nextIndex % numPlayers];
    if (playerToCheck && playerToCheck.hp > 0) {
      return nextIndex;
    }
    nextIndex++;
  }
  return nextIndex; // Fallback
}

const checkWinCondition = async () => {
  if (isProcessingGameOver.value) return true
  const alivePlayers = playersList.value.filter(p => p.hp > 0)

  if (alivePlayers.length === 0) {
    const statusSuccess = await safeUpdateRoomStatus(roomId.value, 'playing', 'gameover')
    if (!statusSuccess) return true

    isProcessingGameOver.value = true
    playGameOver()
    gameOverData.value = {
      word: '全滅',
      reading: 'ぜんめつ',
      comment: '全員脱落！履歴から結果を見てみよう👀',
      image: null
    }
    chatData.value = { text: 'HPがなくなってしまったね…💀 全員脱落でゲームオーバー！', image: null }
    currentState.value = 'gameover'
    
    const payload = {
      room_id: roomId.value,
      player_id: playerId.value, // Last person who died triggers this
      detected_word: '全滅',
      reading: 'ぜんめつ',
      next_char: 'ん', 
      comment: '生存者が0人になりました...全員脱落です💀',
      image_base64: null
    }
    const { error: wError } = await supabase.from('words').insert([payload])
    if (wError) console.error('Words insert error (wipeout):', wError)
    return true
  }

  if (playersList.value.length > 1 && alivePlayers.length === 1) {
    const statusSuccess = await safeUpdateRoomStatus(roomId.value, 'playing', 'gameover')
    if (!statusSuccess) return true

    isProcessingGameOver.value = true
    const winner = alivePlayers[0]
    playSuccess()
    gameOverData.value = {
      word: 'サバイバル勝利',
      reading: 'さばいばるしょうり',
      comment: `${winner.name} さんの完全勝利です！🎉 他のプレイヤーは全員脱落しました💀`,
      image: null
    }
    chatData.value = { text: `${winner.name} さんの完全勝利です！🎉`, image: null }
    currentState.value = 'clear'
    
    const payload = {
      room_id: roomId.value,
      player_id: winner.id,
      detected_word: '優勝',
      reading: 'ゆうしょう',
      next_char: 'ん', 
      comment: `${winner.name} さんの完全勝利です！🎉`,
      image_base64: null
    }
    const { error: wError } = await supabase.from('words').insert([payload])
    if (wError) console.error('Words insert error (survival):', wError)
    return true
  }
  return false
}

const startCamera = async () => {
  try {
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    })
    if (videoRef.value) {
      videoRef.value.srcObject = stream.value
    }
  } catch (err) {
    console.error('Camera error:', err)
    alert('カメラの起動に失敗しました😢')
  }
}

const captureAndCompressImage = () => {
  if (!videoRef.value || !canvasRef.value) return null
  const video = videoRef.value
  const canvas = canvasRef.value
  const context = canvas.getContext('2d')
  
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  
  return canvas.toDataURL('image/jpeg', 0.6)
}

const uploadImageToStorage = async (base64Str) => {
  if (!base64Str) return null;
  try {
    const b64Data = base64Str.replace(/^data:image\/\w+;base64,/, '');
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      byteArrays.push(new Uint8Array(byteNumbers));
    }
    const blob = new Blob(byteArrays, {type: 'image/jpeg'});
    const fileName = `${roomId.value}/${Date.now()}_${Math.floor(Math.random()*1000)}.jpg`;
    const { data, error } = await supabase.storage.from('shiritori-images').upload(fileName, blob, { contentType: 'image/jpeg' });
    if (!error) {
      // 1時間（3600秒）で有効期限が切れるSigned URLを発行
      const { data: signedData, error: signedError } = await supabase.storage.from('shiritori-images').createSignedUrl(fileName, 3600);
      if (!signedError && signedData) {
        return signedData.signedUrl;
      }
    }
  } catch (err) {
    console.error('Image upload failed:', err);
  }
  return null;
}

const handleAction = async () => {
  if (!isMyTurn.value || currentState.value === 'processing') return
  currentState.value = 'processing'
  
  const base64DataWithPrefix = captureAndCompressImage()
  if (base64DataWithPrefix) {
    capturedImage.value = base64DataWithPrefix
    if (videoRef.value) videoRef.value.pause()
  } else {
    chatData.value = { text: '画像のキャプチャに失敗しました😢', image: null }
    currentState.value = 'initial'
    return
  }

  const base64Data = base64DataWithPrefix.replace(/^data:image\/\w+;base64,/, '')
  chatData.value = { text: 'AIがガン見でチェック中...👀✨', image: null }

  if (turnCount.value >= 10) {
    const statusSuccess = await safeUpdateRoomStatus(roomId.value, 'playing', 'gameover')
    if (!statusSuccess) {
      currentState.value = 'initial'
      return
    }

    if (isProcessingGameOver.value) return
    isProcessingGameOver.value = true
    playSuccess()
    
    let uploadedUrl = null;
    if (roomShareEnabled.value) uploadedUrl = await uploadImageToStorage(base64DataWithPrefix);

    gameOverData.value = {
      word: '10ターン達成',
      reading: 'じゅったーんたっせい',
      comment: '10ターン耐え抜いた！プレイヤー達の完全勝利（引き分け）！🎉',
      image: uploadedUrl
    }
    chatData.value = { text: '10ターン耐え抜いた！プレイヤー達の完全勝利（引き分け）！🎉', image: null }
    currentState.value = 'gameover'
    
    const payload = {
      room_id: roomId.value,
      player_id: playerId.value,
      detected_word: '引き分け',
      reading: 'ひきわけ',
      next_char: 'ん', // trigger gameover highlight
      comment: '10ターン耐え抜いた！プレイヤー達の完全勝利（引き分け）！🎉',
      image_base64: uploadedUrl
    }
    const { error: wError } = await supabase.from('words').insert([payload])
    if (wError) console.error('Words insert error (draw):', wError)
    return
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8500)
    
    const response = await fetch('/api/judgment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        imageBase64: base64Data,
        lastChar: targetLetter.value,
        turnCount: turnCount.value,
        difficulty: roomDifficulty.value
      }),
      signal: controller.signal
    })
    
    clearTimeout(timeoutId)
    
    if (!response.ok) throw new Error('API request failed')
    const result = await response.json()

    if (result.is_game_over || result.reading?.endsWith('ん') || result.next_char === 'ん') {
      const statusSuccess = await safeUpdateRoomStatus(roomId.value, 'playing', 'gameover')
      if (!statusSuccess) {
        currentState.value = 'initial'
        return
      }

      if (isProcessingGameOver.value) return
      isProcessingGameOver.value = true
      playGameOver()
      
      let uploadedUrl = null;
      if (roomShareEnabled.value) uploadedUrl = await uploadImageToStorage(base64DataWithPrefix);
      
      gameOverData.value = {
        word: result.detected_word,
        reading: result.reading,
        comment: result.comment,
        image: uploadedUrl
      }
      chatData.value = { text: '「ん」がついちゃったね…💀 ゲームオーバー！', image: null }
      currentState.value = 'gameover'
      
      const payload = {
        room_id: roomId.value,
        player_id: playerId.value,
        detected_word: result.detected_word,
        reading: result.reading,
        next_char: result.next_char,
        comment: result.comment,
        image_base64: uploadedUrl
      }
      const { error: wError } = await supabase.from('words').insert([payload])
      if (wError) console.error('Words insert error:', wError)
    } else if (result.is_valid) {
      const expectedTurn = currentTurnIndex.value
      const turnSuccess = await safeUpdateRoomTurn(roomId.value, expectedTurn, getNextTurnIndex(expectedTurn), result.next_char)
      if (!turnSuccess) {
        currentState.value = 'initial'
        return
      }

      playSuccess()
      triggerWordAnimation(result.detected_word, result.reading)
      latestMyWord.value = result.detected_word
      
      let uploadedUrl = null;
      if (roomShareEnabled.value) uploadedUrl = await uploadImageToStorage(base64DataWithPrefix);

      chatData.value = { text: result.comment, image: uploadedUrl }
      const payload = {
        room_id: roomId.value,
        player_id: playerId.value,
        detected_word: result.detected_word,
        reading: result.reading,
        next_char: result.next_char,
        comment: result.comment,
        image_base64: uploadedUrl
      }
      const { error: wError } = await supabase.from('words').insert([payload])
      if (wError) console.error('Words insert error:', wError)
      
      turnCount.value++
      targetLetter.value = result.next_char
      capturedImage.value = null
      if (videoRef.value) videoRef.value.play()
      currentState.value = 'initial'
    } else {
      const myPlayer = playersList.value.find(p => p.id === playerId.value)
      if (myPlayer) {
        const expectedHp = myPlayer.hp
        const newHp = Math.max(0, expectedHp - 1)
        const hpSuccess = await safeUpdatePlayerHp(playerId.value, expectedHp, newHp, roomId.value)
        if (!hpSuccess) {
          currentState.value = 'initial'
          return
        }
        
        playFailure()
        chatData.value = { text: result.comment, image: null }
        myPlayer.hp = newHp
        
        if (newHp <= 0) {
          const isOver = await checkWinCondition()
          if (!isOver) {
            const expectedTurn = currentTurnIndex.value
            const turnSuccess = await safeUpdateRoomTurn(roomId.value, expectedTurn, getNextTurnIndex(expectedTurn), targetLetter.value)
            if (!turnSuccess) {
              currentState.value = 'initial'
              return
            }
            currentState.value = 'initial'
          }
        } else {
          currentState.value = 'failure'
        }
      } else {
        currentState.value = 'failure'
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('API timeout: aborted')
      chatData.value = { text: 'AIが悩みすぎちゃったみたい🤯 もう一回撮影してみて！', image: null }
      capturedImage.value = null
      currentState.value = 'initial'
      if (videoRef.value) videoRef.value.play()
    } else {
      console.error('Fetch error:', error)
      chatData.value = { text: '通信エラーが発生したみたい💦 もう一回やってみて🙏', image: null }
      currentState.value = 'failure'
    }
  } finally {
    if (currentState.value !== 'gameover' && currentState.value !== 'clear') {
      isProcessingGameOver.value = false
    }
  }
}

const passMyTurn = async () => {
  if (!isMyTurn.value || currentState.value === 'processing' || !myPlayer.value) return
  
  // 実行直前の再確認 (要件3)
  const expectedTurn = currentTurnIndex.value
  const expectedHp = myPlayer.value.hp
  
  currentState.value = 'processing'
  
  const newHp = Math.max(0, expectedHp - 1)
  const hpSuccess = await safeUpdatePlayerHp(playerId.value, expectedHp, newHp, roomId.value)
  if (!hpSuccess) {
    currentState.value = 'initial'
    return
  }
  
  // Update local state BEFORE checking win condition
  const playerInList = playersList.value.find(p => p.id === playerId.value)
  if (playerInList) playerInList.hp = newHp
  
  if (newHp <= 0) {
    const isOver = await checkWinCondition()
    if (!isOver) {
      const turnSuccess = await safeUpdateRoomTurn(roomId.value, expectedTurn, getNextTurnIndex(expectedTurn), targetLetter.value)
      if (!turnSuccess) {
        currentState.value = 'initial'
        return
      }
      currentState.value = 'initial'
    }
  } else {
    chatData.value = { text: `${myPlayer.value.name} がパスしました💨`, image: null }
    const turnSuccess = await safeUpdateRoomTurn(roomId.value, expectedTurn, getNextTurnIndex(expectedTurn), targetLetter.value)
    if (!turnSuccess) {
      currentState.value = 'initial'
      return
    }
    currentState.value = 'initial'
  }
}

const surrender = async () => {
  if (!confirm('本当に降参して部屋を抜けますか？')) return
  if (myPlayer.value && myPlayer.value.hp > 0) {
    const expectedHp = myPlayer.value.hp
    const hpSuccess = await safeUpdatePlayerHp(playerId.value, expectedHp, 0, roomId.value)
    if (!hpSuccess) {
      // 既に状態が変わっていても強制的に退出処理は進める
    }
    
    // Update local state BEFORE checking win condition
    const playerInList = playersList.value.find(p => p.id === playerId.value)
    if (playerInList) playerInList.hp = 0
    
    // Check if the game should end (last man standing / wipeout)
    const isOver = await checkWinCondition()
    if (!isOver && isMyTurn.value) {
      const expectedTurn = currentTurnIndex.value
      await safeUpdateRoomTurn(roomId.value, expectedTurn, getNextTurnIndex(expectedTurn), targetLetter.value)
    }
  }
  
  await leaveLobby()
  window.location.href = '/'
}

const resetGame = async () => {
  if (isHost.value) {
    const updates = playersList.value.map(p => supabase.rpc('update_player_hp', { p_player_id: p.id, p_new_hp: Number(initialHp.value) }))
    await Promise.all(updates)
    
    await supabase.rpc('reset_room', { p_room_id: roomId.value, p_host_id: playerId.value })
  }
}

const retry = () => {
  currentState.value = 'initial'
  chatData.value = { text: `次は【${targetLetter.value}】！もう１回撮ってみて📸`, image: null }
  capturedImage.value = null
  if (videoRef.value) videoRef.value.play()
}

const fetchHistoryData = async () => {
  try {
    let currentRoomId = roomId.value
    if (!currentRoomId) {
      const params = new URLSearchParams(window.location.search)
      currentRoomId = params.get('room')
      if (currentRoomId) roomId.value = currentRoomId
    }
    
    if (!currentRoomId) {
      console.error('Fetch history error: room_id is missing!')
      return
    }

    const { data, error } = await supabase.from('words').select('*').eq('room_id', currentRoomId).order('created_at', { ascending: true })
    if (error) console.error('Fetch history error:', error)
    historyList.value = data || []
  } catch (err) {
    console.error('Fetch history exception:', err)
  }
}

const viewHistory = async () => {
  currentMode.value = 'history'
  await fetchHistoryData()
}

watch(currentMode, async (newVal) => {
  if (newVal === 'history') {
    await fetchHistoryData()
  }
})

const goBackToPrevious = () => {
  currentMode.value = 'play'
}

const getPlayerName = (pId) => {
  const player = playersList.value.find(p => p.id === pId)
  return player ? player.name : '不明'
}

const goBackToTop = async () => {
  await leaveLobby()
  window.location.href = '/'
}
</script>

<template>
  <div v-if="isReconnecting && !isAdminMode" class="fixed top-0 left-0 w-full bg-red-500 text-white text-center py-1 text-xs font-bold z-[200] animate-pulse">
    📡 接続が不安定です。再接続中...
  </div>
  <div v-if="!isAdminMode"
    class="w-full bg-pink-50 flex flex-col items-center p-3 font-bold max-w-md mx-auto relative"
    :class="currentMode === 'play' ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh] overflow-x-hidden overflow-y-auto pt-8 pb-4'"
  >
    <!-- Decorative background elements -->
    <div class="absolute top-[-50px] left-[-50px] w-32 h-32 bg-yellow-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob pointer-events-none z-0"></div>
    <div class="absolute top-[20%] right-[-50px] w-32 h-32 bg-cyan-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-2000 pointer-events-none z-0"></div>
    <div class="absolute bottom-[-50px] left-[20%] w-40 h-40 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-4000 pointer-events-none z-0"></div>

    <!-- Recovering Overlay -->
    <div v-if="isRecovering" class="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm text-white">
      <div class="text-6xl mb-4 animate-bounce">🔄</div>
      <p class="text-xl font-bold animate-pulse">ゲームに復帰中...</p>
    </div>

    <!-- Image Modal -->
    <div v-if="selectedImage" class="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm transition-opacity" @click="selectedImage = null">
      <div class="relative w-full max-w-sm">
        <img :src="selectedImage" class="w-full rounded-2xl border-4 border-white shadow-2xl object-contain max-h-[80vh]" />
        <button class="absolute -top-4 -right-4 w-10 h-10 bg-pink-500 text-white rounded-full border-2 border-white shadow-lg flex items-center justify-center text-xl font-black">×</button>
      </div>
    </div>

    <!-- JOIN SCREEN -->
    <template v-if="currentMode === 'join'">
      <button @click="showHowToPlayModal = true" class="absolute top-4 right-4 z-50 bg-white border-2 border-slate-800 rounded-full px-4 py-1.5 text-sm font-bold shadow-[0_4px_0_0_#1e293b] active:shadow-none active:translate-y-[4px] text-slate-700 transition-all flex items-center gap-1"><span>📖</span>遊び方</button>
      <div class="z-10 flex flex-col items-center justify-center flex-1 w-full gap-8 my-auto py-4">
        <h1 class="text-4xl text-slate-800 drop-shadow-sm tracking-wide text-center leading-tight">
          レンズしりとり<br><span class="text-cyan-500 text-5xl">オンライン</span>
        </h1>
        <p class="text-slate-600 text-center text-sm">AIと一緒に、みんなで写真しりとり！</p>
        
        <div class="flex flex-col items-center gap-4 mt-4 w-full max-w-[280px]">
          <div class="w-full">
            <label class="block text-slate-700 text-sm mb-1 ml-1">プレイヤー名 (10文字以内)</label>
            <input type="text" v-model="playerName" maxlength="10" placeholder="なまえをいれてね" class="w-full p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] text-center text-lg focus:outline-none focus:border-cyan-500" />
          </div>

          <div v-if="!roomId" class="w-full mt-2">
            <label class="block text-slate-700 text-sm mb-1 ml-1">難易度</label>
            <select v-model="difficulty" class="w-full p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] text-center text-lg focus:outline-none focus:border-cyan-500 bg-white cursor-pointer appearance-none">
              <option value="easy">初級 🔰</option>
              <option value="normal">中級 ⭐️</option>
              <option value="hard">上級 🔥</option>
            </select>
          </div>

          <div v-if="!roomId" class="w-full mt-2">
            <label class="block text-slate-700 text-sm mb-1 ml-1">初期HP (ライフ) ❤️</label>
            <select v-model="initialHp" class="w-full p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] text-center text-lg focus:outline-none focus:border-cyan-500 bg-white cursor-pointer appearance-none">
              <option :value="1">1</option>
              <option :value="3">3</option>
              <option :value="5">5</option>
              <option :value="10">10</option>
            </select>
          </div>
          <div v-if="!roomId" class="w-full mt-2">
            <label class="block text-slate-700 text-sm mb-1 ml-1">定員 (2〜8人) 👥</label>
            <select v-model="maxPlayers" class="w-full p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] text-center text-lg focus:outline-none focus:border-cyan-500 bg-white cursor-pointer appearance-none">
              <option :value="2">2</option>
              <option :value="3">3</option>
              <option :value="4">4</option>
              <option :value="5">5</option>
              <option :value="6">6</option>
              <option :value="7">7</option>
              <option :value="8">8</option>
            </select>
          </div>


          <label v-if="!roomId" class="flex items-center justify-between w-full cursor-pointer bg-white p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] mt-2">
            <span class="text-slate-700 text-sm">画像を共有する📸</span>
            <div class="relative">
              <input type="checkbox" v-model="isImageShareEnabled" class="sr-only" />
              <div class="block w-12 h-7 rounded-full border-2 border-slate-800 transition-colors" :class="isImageShareEnabled ? 'bg-cyan-400' : 'bg-slate-300'"></div>
              <div class="absolute left-1 top-1 bg-white w-5 h-5 rounded-full border-2 border-slate-800 transition-transform" :class="{'translate-x-5': isImageShareEnabled}"></div>
            </div>
          </label>

          <div class="space-y-2 mt-4">
            <label class="flex items-center justify-start w-full cursor-pointer bg-white p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] gap-2">
              <input type="checkbox" v-model="isAgreed" class="w-5 h-5 rounded border-slate-800 text-cyan-500 focus:ring-cyan-500" />
              <span class="text-slate-700 text-sm font-bold leading-tight flex-1">
                <a href="#" @click.prevent="showRulesModal = true" class="text-cyan-600 underline hover:text-cyan-500">利用ルール・安全ガイド</a> に同意する
              </span>
            </label>

            <label class="flex items-center justify-start w-full cursor-pointer bg-white p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] gap-2">
              <input type="checkbox" v-model="isPrivacyAgreed" class="w-5 h-5 rounded border-slate-800 text-cyan-500 focus:ring-cyan-500" />
              <span class="text-slate-700 text-sm font-bold leading-tight flex-1">
                <a href="#" @click.prevent="showPrivacyPolicyModal = true" class="text-cyan-600 underline hover:text-cyan-500">プライバシーポリシー</a> を確認した
              </span>
            </label>
          </div>

          <button 
            v-if="!roomId"
            @click="joinRandomRoom"
            :disabled="!playerName.trim() || isJoining || !isAgreed || !isPrivacyAgreed"
            class="w-full py-4 mt-4 rounded-2xl text-xl text-white bg-pink-500 hover:bg-pink-400 shadow-[0_6px_0_0_#be185d] transition-all duration-150 disabled:opacity-50 disabled:shadow-none disabled:translate-y-[6px] active:translate-y-[6px] active:shadow-none"
          >
            <span v-if="isJoining">通信中...</span>
            <span v-else>知らない人と遊ぶ🎉</span>
          </button>

          <button 
            @click="joinOrCreateRoom"
            :disabled="!playerName.trim() || isJoining || !isAgreed || !isPrivacyAgreed"
            class="w-full py-4 mt-2 rounded-2xl text-xl text-slate-800 shadow-[0_6px_0_0_#ca8a04] transition-all duration-150 disabled:opacity-50 disabled:shadow-none disabled:translate-y-[6px]"
            :class="!roomId ? 'bg-yellow-400 hover:bg-yellow-300 active:shadow-[0_0px_0_0_#ca8a04] active:translate-y-[6px]' : 'bg-cyan-400 hover:bg-cyan-300 text-white shadow-[0_6px_0_0_#0891b2] active:shadow-[0_0px_0_0_#0891b2] active:translate-y-[6px]'"
          >
            <span v-if="isJoining">通信中...</span>
            <span v-else>{{ !roomId ? '友達と遊ぶ🤝' : '部屋に参加🤝' }}</span>
          </button>
        </div>
        <footer class="mt-6 flex flex-col gap-2 items-center">
          <div class="flex items-center gap-4">
            <a href="#" @click.prevent="showRulesModal = true" class="text-xs text-slate-500 underline hover:text-slate-700 font-bold">利用ルール・安全ガイド🔰</a>
            <a href="https://forms.gle/YXWKWkTRPWFBArfo7" target="_blank" rel="noopener noreferrer" class="text-xs text-slate-500 underline hover:text-slate-700 font-bold">ご意見・お問い合わせ 📮</a>
          </div>
          <a href="https://note.com/jazzy_begin" target="_blank" rel="noopener noreferrer" class="text-[12px] text-slate-500 hover:text-cyan-600 font-medium tracking-widest underline decoration-slate-300 underline-offset-4">&copy; United Make Associates</a>
        </footer>
      </div>
    </template>

    <!-- LOBBY SCREEN -->
    <template v-else-if="currentMode === 'lobby'">
      <div class="z-10 flex flex-col items-center justify-center flex-1 w-full gap-4 max-w-sm my-auto py-4">
        <h2 class="text-2xl text-slate-800 font-black mb-2">待機ロビー 🛋️</h2>
        <div class="w-full bg-white rounded-2xl border-4 border-slate-800 shadow-[0_6px_0_0_#1e293b] p-4 flex flex-col gap-3">
          <h3 class="text-slate-500 text-sm text-center border-b-2 border-dashed border-slate-200 pb-2">現在の参加者 ({{ playersList.length }}/{{ roomMaxPlayers }})</h3>
          <ul class="space-y-2">
            <li v-for="(p, idx) in playersList" :key="p.id" class="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border-2 border-slate-200" :class="{'opacity-50 grayscale': p.hp <= 0}">
              <span class="w-6 h-6 rounded-full bg-cyan-400 text-white flex items-center justify-center text-xs shrink-0">{{ idx + 1 }}</span>
              <span class="text-slate-800 truncate flex-1" :class="{'line-through': p.hp <= 0}">{{ p.name }}</span>
              <span class="text-xs tracking-widest text-pink-500 shrink-0">{{ '❤️'.repeat(p.hp || 0) }}{{ '🖤'.repeat(Math.max(0, initialHp - (p.hp || 0))) }}</span>
              <span v-if="!isPublicRoom && p.id === hostId" class="text-[10px] bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded-full shrink-0">ホスト</span>
              <span v-if="isPublicRoom && p.is_ready" class="text-[10px] bg-green-400 text-white px-2 py-0.5 rounded-full shrink-0 font-bold">✅ 準備OK</span>
            </li>
            <li v-if="playersList.length === 0" class="text-center text-slate-400 text-sm py-4">読み込み中...</li>
          </ul>
        </div>
        
        <p v-if="isPublicRoom && countdownTime !== null" class="text-pink-500 font-bold text-lg animate-pulse mt-4">ゲーム開始まであと {{ countdownTime }}秒...</p>
        <p v-else-if="isPublicRoom && playersList.length < 2" class="text-slate-500 text-sm animate-pulse mt-4">他のプレイヤーを待っています...（2人以上でスタート可能！）</p>
        <p v-else-if="isPublicRoom && playersList.length >= 2" class="text-pink-500 font-bold text-sm animate-pulse mt-4">準備ができたらボタンを押してください！</p>
        <p v-else-if="!isHost" class="text-slate-500 text-sm animate-pulse mt-4">ホストが開始するのを待っています...</p>
        
        <div class="w-full flex flex-col gap-2 mt-4">
          <button 
            v-if="!isPublicRoom"
            @click="shareRoomLink"
            class="w-full py-4 rounded-2xl text-xl text-slate-800 bg-white border-4 border-slate-800 shadow-[0_6px_0_0_#1e293b] transition-all duration-150 active:shadow-none active:translate-y-[6px]"
          >
            友達を招待する🔗
          </button>
          
          <button 
            v-if="isPublicRoom"
            @click="toggleReady"
            class="w-full py-4 rounded-2xl text-xl text-white transition-all duration-150 active:shadow-none active:translate-y-[6px]"
            :class="myPlayer?.is_ready ? 'bg-green-500 hover:bg-green-400 shadow-[0_6px_0_0_#15803d]' : 'bg-pink-500 hover:bg-pink-400 shadow-[0_6px_0_0_#be185d]'"
          >
            {{ myPlayer?.is_ready ? '準備を取り消す ❌' : '準備完了する ✨' }}
          </button>

          <button 
            v-if="!isPublicRoom && isHost"
            @click="startGame"
            :disabled="playersList.length < 1"
            class="w-full py-4 rounded-2xl text-xl text-white bg-pink-500 hover:bg-pink-400 shadow-[0_6px_0_0_#be185d] transition-all duration-150 active:shadow-none active:translate-y-[6px] disabled:opacity-50 disabled:shadow-none disabled:translate-y-[6px]"
          >
            ゲームスタート！✨
          </button>

          <button 
            @click="goBackToTop"
            class="w-full py-3 mt-2 rounded-2xl text-lg text-slate-500 bg-transparent hover:bg-slate-100 transition-all duration-150"
          >
            退出する 🚪
          </button>
        </div>
        <footer class="mt-6 flex flex-col gap-2 items-center">
          <div class="flex items-center gap-4">
            <a href="#" @click.prevent="showRulesModal = true" class="text-xs text-slate-500 underline hover:text-slate-700 font-bold">利用ルール・安全ガイド🔰</a>
            <a href="https://forms.gle/YXWKWkTRPWFBArfo7" target="_blank" rel="noopener noreferrer" class="text-xs text-slate-500 underline hover:text-slate-700 font-bold">ご意見・お問い合わせ 📮</a>
          </div>
          <a href="https://note.com/jazzy_begin" target="_blank" rel="noopener noreferrer" class="text-[12px] text-slate-500 hover:text-cyan-600 font-medium tracking-widest underline decoration-slate-300 underline-offset-4">&copy; United Make Associates</a>
        </footer>
      </div>
    </template>

    <!-- HISTORY SCREEN -->
    <template v-else-if="currentMode === 'history'">
      <div class="z-20 flex flex-col flex-1 w-full pb-4">
        <h2 class="text-2xl text-center mb-4 text-slate-800 shrink-0 drop-shadow-sm mt-2">しりとり履歴 📜</h2>
        <div class="flex-1 space-y-3 pr-1 pb-4">
           <div v-if="historyList.length === 0" class="text-center text-slate-500 mt-10">まだ履歴がありません</div>
           <div 
             v-for="(item, index) in historyList" 
             :key="item.id || index" 
             class="bg-white p-3 rounded-2xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] flex gap-3 items-start"
             :class="{'border-red-500 shadow-[0_4px_0_0_#ef4444]': item.next_char === 'ん'}"
           >
              <div class="shrink-0 flex flex-col items-center gap-1">
                <span class="text-xs text-slate-400 font-black">#{{ index + 1 }}</span>
                <img v-if="item.image_base64" :src="item.image_base64" class="w-16 h-16 object-cover rounded-xl border-2 border-slate-800 cursor-pointer hover:opacity-80" @click="selectedImage = item.image_base64" />
                <div v-else class="w-16 h-16 bg-slate-100 rounded-xl border-2 border-slate-300 flex items-center justify-center text-slate-400 text-xs">No img</div>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-lg leading-tight truncate text-cyan-600" :class="{'text-red-500': item.next_char === 'ん'}">
                  {{ item.detected_word }} <span class="text-sm text-slate-400">({{ item.reading }})</span>
                </p>
                <p class="text-xs text-slate-600 mt-1 line-clamp-3 leading-snug">{{ item.comment }}</p>
                <div class="flex justify-between items-end mt-1">
                  <p v-if="item.player_id" class="text-[10px] text-slate-400 font-medium">👤 {{ getPlayerName(item.player_id) }}</p>
                  <button v-if="item.player_id && item.player_id !== playerId" @click="openReport(item.player_id, item.id)" class="text-[10px] text-red-400 underline hover:text-red-500 font-bold">🚨 報告</button>
                </div>
              </div>
           </div>
        </div>
        <div class="shrink-0 pt-2 pb-1 flex gap-2">
          <button @click="goBackToPrevious" class="flex-1 py-3 bg-white text-slate-800 rounded-2xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] active:translate-y-[4px] active:shadow-none transition-all text-sm">前の画面へ戻る🔙</button>
          <button @click="goBackToTop" class="flex-1 py-3 bg-white text-slate-800 rounded-2xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] active:translate-y-[4px] active:shadow-none transition-all text-sm">トップへ戻る🏠</button>
        </div>
      </div>
    </template>

    <!-- PLAY SCREEN -->
    <template v-else>
      <header v-if="currentState !== 'gameover' && currentState !== 'clear'" class="w-full text-center shrink-0 my-1 z-10 flex flex-col items-center relative">
        <!-- Turn indicator -->
        <div class="mb-2 flex flex-wrap items-center justify-center gap-2">
          <div class="px-4 py-1 rounded-full border-2 border-slate-800 bg-white shadow-sm font-black text-sm" :class="isMyTurn ? 'text-pink-500 border-pink-500' : 'text-slate-600'">
            今は {{ activePlayer?.name }} のターン！
          </div>
          <div class="px-3 py-1 rounded-full border-2 border-slate-800 bg-white shadow-sm font-black text-xs text-slate-600">
            難易度: {{ roomDifficulty === 'easy' ? '初級🔰' : (roomDifficulty === 'hard' ? '上級🔥' : '中級⭐️') }}
          </div>
        </div>
        <div class="mb-1 flex flex-wrap items-center justify-center gap-2">
          <div v-if="myPlayer" class="text-sm font-black text-slate-700 bg-white/70 px-3 py-0.5 rounded-full border-2 border-white shadow-sm">
            自分のHP: {{ '❤️'.repeat(myPlayer.hp) }}{{ '🖤'.repeat(Math.max(0, initialHp - myPlayer.hp)) }}
          </div>
          <button v-if="(myPlayer?.hp || 0) > 0" @click="surrender" class="px-2 py-0.5 bg-white border-2 border-slate-800 rounded-lg text-xs font-black shadow-[0_2px_0_0_#1e293b] text-slate-600 active:translate-y-[2px] active:shadow-none transition-all">降参🏳️</button>
        </div>
        <h1 class="text-xl text-slate-800 drop-shadow-sm tracking-wide">
          次は、【<span class="text-3xl text-cyan-500 drop-shadow-md">{{ targetLetter }}</span> 】から！📸
        </h1>
      </header>

      <main class="w-full flex-grow min-h-0 relative z-10 mb-2 flex flex-col">
        <div class="relative w-full h-full rounded-3xl shadow-inner border-4 border-white overflow-hidden flex flex-col items-center justify-center"
             :class="currentState === 'gameover' ? 'bg-red-50' : 'bg-slate-900'">
             
          <template v-if="currentState === 'gameover'">
            <div class="w-full h-full flex flex-col items-center justify-center p-6 text-center animate-pulse-once">
               <h2 class="text-5xl mb-2 drop-shadow-md text-red-500 transform -rotate-3 font-black tracking-widest">GAMEOVER</h2>
               <div class="bg-white p-4 rounded-2xl border-4 border-slate-800 shadow-[6px_6px_0_0_#1e293b] my-4 w-full relative">
                 <p class="text-sm text-slate-500 mb-1 font-black">
                   <template v-if="gameOverData?.word === '全滅'">残念...全員脱落💀</template>
                   <template v-else-if="gameOverData?.word === '引き分け' || gameOverData?.word === '10ターン達成'">お見事！10ターン完走🎉</template>
                   <template v-else-if="gameOverData?.word === '優勝' || gameOverData?.word === 'サバイバル勝利'">勝者決定！👑</template>
                   <template v-else>最後に「ん」がついた単語</template>
                 </p>
                 <p class="text-3xl text-slate-800 mb-2 underline decoration-red-500 decoration-4 underline-offset-4">{{ gameOverData?.word }}</p>
                 <p class="text-sm text-slate-600">({{ gameOverData?.reading }})</p>
                 
                 <div v-if="gameOverData?.image" class="mt-4 flex justify-center">
                   <img :src="gameOverData?.image" class="w-32 h-32 object-cover rounded-xl border-2 border-slate-800 shadow-sm cursor-pointer" @click="selectedImage = gameOverData?.image" />
                 </div>
               </div>
               <p class="text-sm text-slate-700 bg-white/80 p-3 rounded-xl border-2 border-red-200">{{ gameOverData?.comment }}</p>
               <button v-if="activePlayer?.id && activePlayer?.id !== playerId" @click="openReport(activePlayer?.id)" class="mt-4 text-sm text-red-500 underline decoration-red-300 hover:text-red-600 font-bold bg-white/80 px-3 py-1 rounded-lg">🚨 この結果を報告する</button>
            </div>
          </template>
          
          <template v-else>
            <!-- Spectator overlay -->
            <div v-if="(playersList.find(p => p.id === playerId)?.hp || 0) <= 0" class="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center z-[15] p-4 text-center backdrop-blur-sm">
              <div class="text-6xl mb-4">💀</div>
              <p class="text-white text-2xl font-black mb-2 text-red-400">あなたは脱落しました...</p>
              <p class="text-slate-300 text-sm mb-8">他のプレイヤーの観戦中 👀</p>
              <button @click="goBackToTop" class="px-6 py-3 bg-slate-700 text-white font-bold rounded-2xl border-2 border-slate-500 shadow-[0_4px_0_0_#475569] active:shadow-none active:translate-y-[4px] transition-all">
                トップへ戻る（退出）🏠
              </button>
            </div>

            <video 
              ref="videoRef"
              class="absolute inset-0 w-full h-full object-cover"
              autoplay 
              playsinline
              muted
              :class="{'hidden': capturedImage || !isMyTurn}"
            ></video>
            
            <img 
              v-if="capturedImage && isMyTurn"
              :src="capturedImage" 
              class="absolute inset-0 w-full h-full object-cover" 
            />

            <!-- Not my turn overlay -->
            <div v-if="!isMyTurn && currentState !== 'processing' && (playersList.find(p => p.id === playerId)?.hp || 0) > 0" class="absolute inset-0 bg-slate-800/80 flex flex-col items-center justify-center z-10 p-4">
              <div class="w-16 h-16 mb-4 rounded-full bg-cyan-400 border-2 border-white flex items-center justify-center text-3xl animate-bounce">👀</div>
              <p class="text-white text-lg">{{ activePlayer?.name }} の判定待ち...</p>
            </div>

            <div v-if="currentState === 'processing'" class="absolute inset-0 bg-slate-800/40 backdrop-blur-sm flex items-center justify-center z-20">
              <div class="w-full h-1 bg-cyan-400 shadow-[0_0_15px_5px_rgba(34,211,238,0.5)] absolute top-0 animate-scan"></div>
            </div>
            
            <div v-if="showCameraWarning" class="absolute top-4 left-0 right-0 z-50 flex justify-center animate-fade-in-up pointer-events-none px-4">
              <div class="bg-slate-900/90 text-white text-xs sm:text-sm font-bold px-4 py-3 rounded-2xl shadow-lg border border-slate-700 flex flex-col items-center gap-1">
                <div class="flex items-center gap-2">
                  <span>⚠️</span>
                  <span>他人や個人情報が写り込まないよう注意してね！</span>
                </div>
                <div class="text-[10px] text-slate-300">※ゲームのために危険な場所へ入らないでください</div>
              </div>
            </div>

            <!-- Word Animation Overlay -->
            <div v-if="wordAnimationData" class="absolute inset-0 flex flex-col items-center justify-center z-[60] pointer-events-none px-4 drop-shadow-2xl">
              <div class="bg-white/95 px-8 py-6 rounded-3xl border-4 border-cyan-400 transform -rotate-3 text-center shadow-[0_10px_25px_-5px_rgba(0,0,0,0.5)] animate-fade-in-up">
                <p class="text-sm font-black text-slate-500 tracking-widest mb-1">{{ wordAnimationData.reading }}</p>
                <p class="text-5xl font-black text-slate-800 tracking-wider">『{{ wordAnimationData.word }}』</p>
              </div>
            </div>
            
            <canvas ref="canvasRef" class="hidden"></canvas>
          </template>
        </div>
      </main>

      <!-- Chat Bubble -->
      <div v-if="currentState !== 'gameover'" class="w-full shrink-0 mb-3 z-10">
        <div class="flex items-end gap-2">
          <div class="w-10 h-10 rounded-full bg-cyan-100 border-2 border-cyan-400 flex items-center justify-center text-xl shadow-sm shrink-0">🤖</div>
          <div class="relative bg-white text-slate-700 p-3 rounded-2xl rounded-bl-none shadow-md border-2 border-slate-100 text-sm sm:text-base flex-1 max-h-[90px] overflow-y-auto flex gap-3">
            <div class="flex-1">
              <p class="leading-relaxed whitespace-pre-wrap">{{ chatData.text }}</p>
              <div v-if="currentState === 'processing'" class="mt-2 flex space-x-2">
                <div class="w-2.5 h-2.5 bg-cyan-400 rounded-full animate-bounce"></div>
                <div class="w-2.5 h-2.5 bg-yellow-400 rounded-full animate-bounce" style="animation-delay: 0.1s"></div>
                <div class="w-2.5 h-2.5 bg-pink-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
              </div>
              <button v-if="chatData.playerId && chatData.playerId !== playerId" @click="openReport(chatData.playerId, chatData.wordId)" class="mt-1 text-[10px] text-red-400 underline hover:text-red-500 font-bold flex items-center gap-1">
                <span>🚨</span>報告する
              </button>
            </div>
            <div v-if="chatData.image" class="shrink-0 flex items-center">
              <img :src="chatData.image" class="w-12 h-12 rounded-lg border-2 border-slate-800 object-cover shadow-sm cursor-pointer hover:scale-105 transition-transform" @click="selectedImage = chatData.image" />
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="w-full shrink-0 mb-2 z-10 flex flex-col gap-2">
        <template v-if="currentState === 'gameover'">
          <button @click="viewHistory" class="w-full py-3 rounded-2xl text-lg bg-white text-slate-800 border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] hover:bg-slate-50 transition-all active:translate-y-[4px] active:shadow-none">
            みんなの履歴を見る✨
          </button>
          <button v-if="isHost" @click="resetGame" class="w-full py-3 rounded-2xl text-lg bg-cyan-400 text-white shadow-[0_4px_0_0_#0891b2] hover:bg-cyan-300 transition-all active:translate-y-[4px] active:shadow-none">
            もう一回遊ぶ？🔁 (ホストのみ)
          </button>
          <button @click="goBackToTop" class="w-full py-3 mt-2 rounded-2xl text-lg text-slate-500 bg-transparent hover:bg-slate-100 transition-all duration-150 border-2 border-transparent hover:border-slate-200">
            退出してトップへ戻る 🚪
          </button>
        </template>
        
        <template v-else>
          <div v-if="(playersList.find(p => p.id === playerId)?.hp || 0) > 0" class="flex flex-col gap-2 w-full">
            <button 
              v-if="currentState === 'initial' || currentState === 'processing'"
              @click="handleAction"
              :disabled="!isMyTurn || currentState === 'processing'"
              class="w-full py-3 rounded-2xl text-lg transition-all duration-150"
              :class="{
                'bg-yellow-400 text-slate-800 shadow-[0_4px_0_0_#ca8a04] hover:bg-yellow-300 active:shadow-none active:translate-y-[4px]': isMyTurn && currentState !== 'processing',
                'bg-slate-300 text-slate-500 cursor-not-allowed shadow-[0_4px_0_0_#94a3b8]': !isMyTurn || currentState === 'processing'
              }"
            >
              <span class="flex items-center justify-center gap-2">
                {{ currentState === 'processing' ? '判定中...' : (isMyTurn ? 'これで勝負！！✨' : 'あなたの番ではありません') }}
              </span>
            </button>
            
            <button 
              v-if="(currentState === 'initial' || currentState === 'processing') && isMyTurn"
              @click="passMyTurn"
              :disabled="currentState === 'processing'"
              class="w-full py-2 rounded-xl text-sm bg-slate-100 text-slate-500 border-2 border-slate-300 hover:bg-slate-200 transition-all duration-150 active:translate-y-[2px] disabled:opacity-50"
            >
              パスする (HPを1消費) 💨
            </button>
            
            <button 
              v-if="currentState === 'failure'"
              @click="retry"
              class="w-full py-3 rounded-2xl text-lg bg-orange-400 text-white shadow-[0_4px_0_0_#c2410c] hover:bg-orange-300 transition-all duration-150 active:shadow-none active:translate-y-[4px]"
            >
              撮り直す📸
            </button>
          </div>
        </template>
      </div>
    </template>
    
    <!-- MODALS -->
    <RulesModal :isOpen="showRulesModal" @close="showRulesModal = false" />
    <HowToPlayModal :isOpen="showHowToPlayModal" @close="showHowToPlayModal = false" />
    <PrivacyPolicyModal :isOpen="showPrivacyPolicyModal" @close="showPrivacyPolicyModal = false" />
    <ReportModal :isOpen="showReportModal" @close="showReportModal = false" @submit="handleReportSubmit" />
  </div>
  
  <AdminPanel v-else />
</template>

<style>
@keyframes blob {
  0% { transform: translate(0px, 0px) scale(1); }
  33% { transform: translate(30px, -50px) scale(1.1); }
  66% { transform: translate(-20px, 20px) scale(0.9); }
  100% { transform: translate(0px, 0px) scale(1); }
}
.animate-blob { animation: blob 7s infinite; }
.animation-delay-2000 { animation-delay: 2s; }
.animation-delay-4000 { animation-delay: 4s; }
@keyframes scan {
  0% { transform: translateY(0); opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { transform: translateY(100vh); opacity: 0; }
}
.animate-scan { animation: scan 2s linear infinite; }
@keyframes pulse-once {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}
.animate-pulse-once { animation: pulse-once 0.3s ease-out; }
</style>
