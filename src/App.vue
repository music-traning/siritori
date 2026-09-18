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

const isAdminAuthenticated = ref(false)
const adminPasswordInput = ref('')
const checkAdminPassword = async () => {
  try {
    const response = await fetch('/api/verify-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPasswordInput.value })
    })
    
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        isAdminAuthenticated.value = true
        return
      }
    }
    
    alert('繝代せ繝ｯ繝ｼ繝峨′髢馴＆縺｣縺ｦ縺・∪縺・)
  } catch (error) {
    console.error('Auth error:', error)
    alert('隱崎ｨｼ繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆')
  }
}

const showRulesModal = ref(false)
const showHowToPlayModal = ref(false)
const showPrivacyPolicyModal = ref(false)
const showReportModal = ref(false)
const reportTarget = ref(null)
const showCameraWarning = ref(false)

// Global State
const currentMode = ref('join') // 'rule-create', 'join', 'lobby', 'play', 'history'
const roomId = ref(null)
const roomStatus = ref('waiting')
const hostId = ref(null)
const roomShareEnabled = ref(false)
const hasPlayedGameOverSound = ref(false)
const isJoining = ref(false)
const isAgreed = ref(false)
const isPrivacyAgreed = ref(false)
const isPublicRoom = ref(false)

// Rule State
const userRuleRequest = ref('')
const isGeneratingRule = ref(false)
const generatedRule = ref(null)
const gameRuleId = ref(null)
const currentRule = ref(null)

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
const isCpuThinking = ref(false)

// Game State
const targetLetter = ref('縺・)
const currentState = ref('initial')
const isProcessingGameOver = ref(false)
const chatData = ref({
  text: '貅門ｙ荳ｭ...笨ｨ',
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

const hiraganaList = "縺ゅ＞縺・∴縺翫°縺阪￥縺代％縺輔＠縺吶○縺昴◆縺｡縺､縺ｦ縺ｨ縺ｪ縺ｫ縺ｬ縺ｭ縺ｮ縺ｯ縺ｲ縺ｵ縺ｸ縺ｻ縺ｾ縺ｿ繧繧√ｂ繧・ｆ繧医ｉ繧翫ｋ繧後ｍ繧上ｒ".split('')

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
  if (currentMode.value === 'play' && currentState.value === 'initial' && activePlayer.value && !activePlayer.value.is_cpu) {
    turnTimeout = setTimeout(async () => {
      if (currentMode.value === 'play' && currentState.value === 'initial' && activePlayer.value) {
        if (isMyTurn.value) {
          alert('60遘堤ｵ碁℃縺ｮ縺溘ａ縲∝ｼｷ蛻ｶ繝代せ縺励∪縺呻ｼ・)
          passMyTurn()
        } else {
          // 繧ｴ繝ｼ繧ｹ繝亥ｯｾ遲・          const myPlayerInfo = playersList.value.find(p => p.id === playerId.value)
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

  const myPlayerInfo = playersList.value.find(p => p.id === playerId.value)
  if (!myPlayerInfo) return false // Not in room

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
    
    // 閾ｪ蛻・′縺吶〒縺ｫ驛ｨ螻九↓縺・ｋ縺狗｢ｺ隱・    await fetchRoomData(room)
    const isAlreadyInRoom = playersList.value.some(p => p.id === playerId.value)

    if (isAlreadyInRoom) {
      const success = await recoverGameState(room)
      if (!success) {
        alert('驛ｨ螻九↓蠕ｩ蟶ｰ縺ｧ縺阪∪縺帙ｓ縺ｧ縺励◆・磯蜃ｺ貂医∩縺区ｺ螳､縺ｧ縺呻ｼ解汳ｦ')
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
  if (!roomId.value || currentMode.value === 'join' || currentMode.value === 'rule-create' || currentMode.value === 'history') return
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
      await recoverGameState(roomId.value)
      
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
    alert('蝣ｱ蜻翫ｒ蜿励￠莉倥￠縺ｾ縺励◆縲ゅ＃蜊泌鴨縺ゅｊ縺後→縺・＃縺悶＞縺ｾ縺咀泗・坂凾・・)
  } catch (e) {
    console.error('Report error:', e)
    alert('蝣ｱ蜻翫・騾∽ｿ｡縺ｫ螟ｱ謨励＠縺ｾ縺励◆�懲')
  }
}
const leaveLobby = async () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
  if (currentMode.value === 'lobby' && roomStatus.value === 'waiting' && playerId.value) {
    await supabase.from('players').update({ room_id: null, is_ready: false }).eq('id', playerId.value)
  }
}

const handleBeforeUnload = (e) => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
  if (currentMode.value === 'lobby' && roomStatus.value === 'waiting' && playerId.value) {
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

// --- Rule Generate Logic ---
const generateRule = async () => {
  if (!userRuleRequest.value.trim()) return
  isGeneratingRule.value = true
  try {
    const res = await fetch('/api/generate-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userRequest: userRuleRequest.value })
    })
    if (!res.ok) throw new Error('API error')
    generatedRule.value = await res.json()
  } catch (error) {
    console.error(error)
    alert('繝ｫ繝ｼ繝ｫ縺ｮ逕滓・縺ｫ螟ｱ謨励＠縺ｾ縺励◆�懲')
  } finally {
    isGeneratingRule.value = false
  }
}

const confirmRule = async () => {
  if (!generatedRule.value) return
  try {
    const { data, error } = await supabase.from('game_rules').insert([
      { 
        title: generatedRule.value.title,
        theme_condition: generatedRule.value.theme_condition,
        forbidden_elements: generatedRule.value.forbidden_elements
      }
    ]).select().single()
    if (error) throw error
    gameRuleId.value = data.id
    currentMode.value = 'join'
  } catch (error) {
    console.error(error)
    alert('繝ｫ繝ｼ繝ｫ縺ｮ菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆�懲')
  }
}

const skipRule = () => {
  gameRuleId.value = null
  currentRule.value = null
  generatedRule.value = null
  currentMode.value = 'join'
}


// --- Join & Lobby Logic ---
const sanitizeAndValidateName = (name) => {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 15) {
    alert('繝励Ξ繧､繝､繝ｼ蜷阪・1縲・5譁・ｭ励〒蜈･蜉帙＠縺ｦ縺上□縺輔＞縲・)
    return null
  }
  
  const urlRegex = /https?:\/\/[^\s]+/i
  const emailRegex = /[^\s@]+@[^\s@]+\.[^\s@]+/i
  if (urlRegex.test(trimmed) || emailRegex.test(trimmed)) {
    alert('URL繧・Γ繝ｼ繝ｫ繧｢繝峨Ξ繧ｹ繧貞性繧蜷榊燕縺ｯ菴ｿ逕ｨ縺ｧ縺阪∪縺帙ｓ縲・)
    return null
  }
  
  return trimmed
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
    
    difficulty.value = 'normal'
    initialHp.value = 3
    isImageShareEnabled.value = false

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
      alert('繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆�懲')
      return
    }

    // RPC縺梧里蟄倥・繝ｬ繧､繝､繝ｼ縺ｮ蜷榊燕繧呈峩譁ｰ縺励↑縺・�ｴ蜷医′縺ゅｋ縺溘ａ縲∵・遉ｺ逧・↓UPDATE縺吶ｋ
    await supabase.from('players').update({ name: String(playerName.value) }).eq('id', playerId.value)

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
      await fetchRoomData(roomId.value)
      if (!hostId.value) {
        alert('驛ｨ螻九′隕九▽縺九ｊ縺ｾ縺帙ｓ�个')
        return
      }
      
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
          alert('貅螳､縺ｾ縺溘・蜿ょ刈繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆�懲')
          return
        }
        
        await supabase.from('players').update({ name: String(playerName.value) }).eq('id', playerId.value)
        
        localStorage.setItem('shiritori_player_id', playerId.value)
        
        const { data: fetchedPlayer, error: fetchErr } = await supabase.from('players').select('*').eq('id', playerId.value).single()
        if (fetchErr) {
          console.error('Player fetch error:', fetchErr)
        } else if (fetchedPlayer) {
          playersList.value.push(fetchedPlayer)
        }
        
        await fetchRoomData(roomId.value)
      } else {
        // 縺吶〒縺ｫ驛ｨ螻九↓縺・ｋ蝣ｴ蜷医〒繧ょ錐蜑阪・螟画峩繧貞渚譏�縺輔○繧・        if (myPlayer.name !== playerName.value) {
          await supabase.from('players').update({ name: String(playerName.value) }).eq('id', playerId.value)
          myPlayer.name = playerName.value
        }
      }
      setupRealtimeSubscription(roomId.value)
      currentMode.value = roomStatus.value === 'playing' ? 'play' : 'lobby'
      if (currentMode.value === 'play') startCamera()
    } else {
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
        max_players: Number(maxPlayers.value),
        rule_id: gameRuleId.value || null
      }]).select().single()

      if (error || !newRoom) {
        console.error('Room create error:', error)
        alert('驛ｨ螻九・菴懈・縺ｫ螟ｱ謨励＠縺ｾ縺励◆�懲')
        return
      }

      await supabase.from('players').update({ name: String(playerName.value) }).eq('id', playerId.value)

      roomId.value = newRoom.id
      const { data: joined, error: pError } = await supabase.rpc('join_room', {
        p_room_id: newRoom.id,
        p_player_id: playerId.value,
        p_name: String(playerName.value),
        p_hp: Number(newRoom.initial_hp || initialHp.value)
      })
      
      if (pError || !joined) {
        console.error('Player insert error:', pError)
        alert('繝励Ξ繧､繝､繝ｼ菴懈・縺ｫ螟ｱ謨励＠縺ｾ縺励◆�个')
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
      chatData.value = { text: `縺輔≠縲∽ｽ墓聴繧九・・・縺ｯ繧・￥縲・{targetLetter.value}縲上°繧牙ｧ九∪繧九ｂ縺ｮ隕九▽縺代※繧芋沽汁, image: null }

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

const addCpuPlayer = async () => {
  if (!isHost.value) return
  if (playersList.value.length >= roomMaxPlayers.value) {
    alert('驛ｨ螻九′貅蜩｡縺ｧ縺呻ｼ√％繧御ｻ･荳願ｿｽ蜉�縺ｧ縺阪∪縺帙ｓ縲・)
    return
  }
  const cpuId = crypto.randomUUID()
  const cpuNames = ['AI繝舌ョ繧｣�､・, '驥冗肇蝙九⊃繧薙％縺､笞呻ｸ・, '髮ｻ閼ｳ縺ｮ隕ｳ貂ｬ閠・汨・ｸ・, '蠖ｷ蠕ｨ縺・い繝ｫ繧ｴ繝ｪ繧ｺ繝��遜', '縺励ｊ縺ｨ繧願・莠ｺ�畑', '隰弱・蛻ｺ螳｢�･ｷ', '隲也炊縺ｮ謗｢豎り・洫�']
  const randomName = cpuNames[Math.floor(Math.random() * cpuNames.length)]
  const { error: pError } = await supabase.from('players').insert([{
    id: cpuId,
    room_id: roomId.value,
    name: randomName,
    hp: Number(initialHp.value),
    is_ready: true,
    is_cpu: true,
    order_index: playersList.value.length
  }])
  
  if (pError) {
    console.error('CPU add error', pError)
    alert('CPU縺ｮ霑ｽ蜉�縺ｫ螟ｱ謨励＠縺ｾ縺励◆�懲')
    return
  }
  
  await supabase.from('rooms').update({ is_cpu_match: true }).eq('id', roomId.value)
}

const countdownTime = ref(null)
let countdownInterval = null

const toggleReady = async () => {
  if (!myPlayer.value) return
  initAudio()
  const newReadyState = !myPlayer.value.is_ready
  myPlayer.value.is_ready = newReadyState
  
  const { error } = await supabase
    .from('players')
    .update({ is_ready: newReadyState, room_id: roomId.value })
    .eq('id', playerId.value)
    
  if (error) {
    console.error('Failed to toggle ready state:', error)
    myPlayer.value.is_ready = !newReadyState
  }
}

watch(playersList, (newList) => {
  if (currentMode.value !== 'lobby' || roomStatus.value !== 'waiting' || !isPublicRoom.value) return

  const validPlayers = newList.filter(p => (p.hp || 0) > 0)
  const readyPlayers = validPlayers.filter(p => p.is_ready && !p.is_cpu)
  const readyCount = readyPlayers.length
  const totalHumanCount = validPlayers.filter(p => !p.is_cpu).length

  if (readyCount >= 2 && readyCount === totalHumanCount) {
    if (countdownInterval) {
      clearInterval(countdownInterval)
      countdownInterval = null
    }
    countdownTime.value = null
    startGame()
  } else if (readyCount >= 2 && readyCount < totalHumanCount) {
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
        title: '繝ｬ繝ｳ繧ｺ縺励ｊ縺ｨ繧翫が繝ｳ繝ｩ繧､繝ｳ',
        text: '荳邱偵↓蜀咏悄縺励ｊ縺ｨ繧翫ｒ縺励ｈ縺・ｼ・,
        url: url
      })
    } catch (err) {
      console.error('Share failed:', err)
    }
  } else {
    try {
      await navigator.clipboard.writeText(url)
      alert('諡帛ｾ・Μ繝ｳ繧ｯ繧偵さ繝斐・縺励∪縺励◆・Å沐・)
    } catch (err) {
      alert('繝ｪ繝ｳ繧ｯ縺ｮ繧ｳ繝斐・縺ｫ螟ｱ謨励＠縺ｾ縺励◆�懲')
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
    targetLetter.value = roomData.current_char || '縺・
    currentTurnIndex.value = roomData.current_turn_index || 0
    roomShareEnabled.value = !!roomData.is_image_share_enabled
    isPublicRoom.value = !!roomData.is_public
    roomDifficulty.value = roomData.difficulty || 'normal'
    initialHp.value = roomData.initial_hp || 3
    roomMaxPlayers.value = roomData.max_players || 5
    chatData.value = { text: `縺輔≠縲∽ｽ墓聴繧具ｼ溘∪縺壹・縲・{targetLetter.value}縲上°繧牙ｧ九∪繧九ｂ縺ｮ隕九▽縺代※繧芋沽～, image: null }
    
    if (roomData.rule_id) {
      const { data: ruleData } = await supabase.from('game_rules').select('*').eq('id', roomData.rule_id).single()
      if (ruleData) currentRule.value = ruleData
    }
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

  const roomChannel = supabase.channel(`rooms-${id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` }, async (payload) => {
    const room = payload.new
    
    // 辟｡譚｡莉ｶ縺ｧ繧ｹ繝・・繧ｿ繧ｹ繧貞叉蠎ｧ縺ｫ蜷梧悄・医ラ繧ｯ繝ｭ逕ｻ髱｢縺ｧ豁｢縺ｾ繧九ヰ繧ｰ縺ｮ菫ｮ豁｣・・    if (room.status === 'clear' || room.status === 'gameover') {
      currentState.value = room.status
      isJudging.value = false
    }

    if (room.status === 'playing') {
      if (currentMode.value === 'lobby') {
        currentMode.value = 'play'
        startCamera()
      } else if (currentState.value === 'gameover' || currentState.value === 'clear') {
        currentMode.value = 'play'
        turnCount.value = 0
        targetLetter.value = room.current_char || '縺・
        currentState.value = 'initial'
        isProcessingGameOver.value = false
        hasPlayedGameOverSound.value = false
        chatData.value = { text: `繝ｬ繝・ぅ繝ｼ繝ｻ繧ｴ繝ｼ・√∪縺壹・縲・{targetLetter.value}縲阪°繧牙ｧ九∪繧玖ｨ闡峨ｒ隕九▽縺代※縺ｭ�剥`, image: null }
        capturedImage.value = null
        if (videoRef.value) videoRef.value.play()
        else startCamera()
      }
    } else if ((room.status === 'gameover' || room.status === 'clear') && !isProcessingGameOver.value) {
      isProcessingGameOver.value = true
      const { data: lastWord } = await supabase.from('words').select('*').eq('room_id', id).order('created_at', { ascending: false }).limit(1).single()
      if (lastWord) {
        gameOverData.value = {
          word: lastWord.detected_word,
          reading: lastWord.reading,
          comment: lastWord.comment,
          image: lastWord.image_base64
        }
        if (lastWord.detected_word === '蜆ｪ蜍・) {
          playSuccess()
        } else {
          playGameOver()
        }
      } else {
        playGameOver()
      }
    }

    currentTurnIndex.value = room.current_turn_index
    targetLetter.value = room.current_char || targetLetter.value
  }).subscribe(handleStatus)

  const playerChannel = supabase.channel(`players-${id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, (payload) => {
    if (payload.eventType === 'INSERT') {
      if (payload.new.room_id === id && !playersList.value.find(p => p.id === payload.new.id)) {
        playersList.value.push(payload.new)
        playersList.value.sort((a, b) => a.order_index - b.order_index)
      }
    } else if (payload.eventType === 'UPDATE') {
      const idx = playersList.value.findIndex(p => p.id === payload.new.id)
      if (payload.new.room_id !== undefined && payload.new.room_id !== id) {
        if (idx !== -1) playersList.value.splice(idx, 1)
        return
      }

      if (idx !== -1) {
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

  const wordChannel = supabase.channel(`words-${id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'words', filter: `room_id=eq.${id}` }, (payload) => {
    const word = payload.new
    if (word.detected_word === latestMyWord.value) {
      latestMyWord.value = '' // clear
    } else {
      if (['蜈ｨ貊・, '蜆ｪ蜍・, '蠑輔″蛻・￠'].includes(word.detected_word) || word.next_char === '繧・) {
        return
      }
      if (isProcessingGameOver.value || currentState.value === 'gameover') {
        return
      }
      turnCount.value++
      targetLetter.value = word.next_char
      
      const playerName = getPlayerName(word.player_id) || '蜿矩＃'
      chatData.value = {
        text: `�側${playerName}: 縲・{word.detected_word}縲条沒ｸ\n${word.comment || '蛻､螳壽・蜉滂ｼ∵ｬ｡縺ｸ郢九℃縺ｾ縺吮惠'}`,
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
      // Ignore CPU players for presence check
      if (p.is_cpu) return
      
      if (!onlineIds.includes(p.id)) {
        setTimeout(() => {
          const currentState = presenceChannel.presenceState()
          const currentOnlineIds = Object.keys(currentState)
          if (!currentOnlineIds.includes(p.id)) {
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

// --- Gameplay Logic & CPU Turn Logic ---
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
  return nextIndex;
}

watch([currentMode, currentState, activePlayer], ([mode, state, player]) => {
  if (mode === 'play' && state === 'initial' && player?.is_cpu) {
    triggerCpuTurn(player)
  }
})

const triggerCpuTurn = async (cpuPlayer) => {
  if (!isHost.value) return 
  if (isCpuThinking.value) return
  isCpuThinking.value = true
  
  chatData.value = { text: 'AI諤晁・ｸｭ...�､・, image: null }
  
  try {
    const { data: wordsData } = await supabase.from('words').select('detected_word').eq('room_id', roomId.value)
    const usedWords = wordsData ? wordsData.map(w => w.detected_word) : []

    const ruleParams = {
      theme_condition: currentRule.value?.theme_condition || '迚ｹ縺ｫ縺ｪ縺・,
      forbidden_elements: currentRule.value?.forbidden_elements || '迚ｹ縺ｫ縺ｪ縺・
    }
    
    const response = await fetch('/api/cpu-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: roomId.value,
        playerId: cpuPlayer.id,
        currentTurnIndex: currentTurnIndex.value,
        lastChar: targetLetter.value,
        difficulty: roomDifficulty.value,
        usedWords: usedWords,
        rule: ruleParams
      })
    })
    
    if (!response.ok) throw new Error('CPU API failed')
    // CPU action logic is now entirely handled by the backend API and Realtime listeners
  } catch (error) {
    console.error('CPU turn error:', error)
    chatData.value = { text: 'AI縺後お繝ｩ繝ｼ繧定ｵｷ縺薙＠縺ｾ縺励◆�､ｯ', image: null }
  } finally {
    isCpuThinking.value = false
  }
}

// Win condition logic is now migrated to backend API
// Frontend now relies on Realtime listener for gameover updates

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
  }
}

const stopCamera = () => {
  if (stream.value) {
    stream.value.getTracks().forEach(track => track.stop())
    stream.value = null
  }
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
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    const blob = new Blob(byteArrays, { type: 'image/jpeg' });
    const fileName = `${roomId.value}/${Date.now()}.jpg`;
    
    const { data, error } = await supabase.storage
      .from('photos')
      .upload(fileName, blob, { contentType: 'image/jpeg' });
      
    if (error) {
      console.error('Upload error:', error);
      return null;
    }
    const { data: urlData } = supabase.storage.from('photos').getPublicUrl(fileName);
    return urlData.publicUrl;
  } catch (e) {
    console.error('Error processing upload:', e);
    return null;
  }
}

const captureImage = () => {
  if (!videoRef.value || !canvasRef.value) return null
  const video = videoRef.value
  const canvas = canvasRef.value
  const context = canvas.getContext('2d')
  
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  
  const dataUrl = canvas.toDataURL('image/jpeg', 0.6)
  return dataUrl.replace(/^data:image\/\w+;base64,/, '')
}

const handleAction = async () => {
  if (currentState.value !== 'initial') return
  if (!isMyTurn.value) return
  
  currentState.value = 'processing'
  const base64Data = captureImage()
  if (!base64Data) {
    currentState.value = 'initial'
    return
  }

  const base64DataWithPrefix = `data:image/jpeg;base64,${base64Data}`
  capturedImage.value = base64DataWithPrefix

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8500)
    
    const ruleParams = {
      theme_condition: currentRule.value?.theme_condition || '迚ｹ縺ｫ縺ｪ縺・,
      forbidden_elements: currentRule.value?.forbidden_elements || '迚ｹ縺ｫ縺ｪ縺・
    }

    const response = await fetch('/api/judgment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        imageBase64: base64Data,
        lastChar: targetLetter.value,
        rule: ruleParams,
        turnCount: turnCount.value,
        difficulty: roomDifficulty.value,
        roomId: roomId.value,
        playerId: playerId.value,
        currentTurnIndex: currentTurnIndex.value
      }),
      signal: controller.signal
    })
    
    clearTimeout(timeoutId)
    
    if (!response.ok) throw new Error('API request failed')
    const result = await response.json()

    if (result.is_valid && !result.is_inappropriate) {
      playSuccess()
      triggerWordAnimation(result.detected_word, result.reading)
      latestMyWord.value = result.detected_word
      chatData.value = { text: result.comment, image: null }
      capturedImage.value = null
      if (videoRef.value) videoRef.value.play()
    } else {
      playFailure()
      chatData.value = { text: result.comment || '荳埼←蛻・↑逕ｻ蜒上・縺溘ａ蠑ｾ縺九ｌ縺ｾ縺励◆�圷', image: null }
    }
    currentState.value = 'initial'

  } catch (err) {
    console.error('Action error:', err)
    chatData.value = { text: '繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆�懲 繧ゅ≧荳蠎ｦ隧ｦ縺励※縺ｭ・・, image: null }
    currentState.value = 'initial'
    capturedImage.value = null
    if (videoRef.value) videoRef.value.play()
  } finally {
    isJudging.value = false
    if (currentState.value !== 'gameover' && currentState.value !== 'clear') {
      isProcessingGameOver.value = false
    }
  }
}

const passMyTurn = async () => {
  if (!isMyTurn.value || currentState.value === 'processing' || !myPlayer.value) return;
  if (myPlayer.value.hp <= 0) return;
  
  currentState.value = 'processing';
  isJudging.value = true;
  chatData.value = { text: 'パスを送信中...', image: null };
  
  try {
    const response = await fetch('/api/judgment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isPass: true,
        roomId: roomId.value,
        playerId: myPlayer.value.id,
        currentTurnIndex: currentTurnIndex.value,
        lastChar: roomData.value?.current_char || 'あ'
      })
    });
    
    if (!response.ok) throw new Error('Pass turn API failed');
  } catch (error) {
    console.error('Pass error:', error);
    chatData.value = { text: 'パスに失敗しました💦', image: null };
  } finally {
    currentState.value = 'initial';
    isJudging.value = false;
  }
}

const surrender = async () => {
  if (!confirm('譛ｬ蠖薙↓髯榊盾縺励※驛ｨ螻九ｒ謚懊￠縺ｾ縺吶°・・)) return
  if (myPlayer.value && myPlayer.value.hp > 0) {
    const expectedHp = myPlayer.value.hp
    const hpSuccess = await safeUpdatePlayerHp(playerId.value, expectedHp, 0, roomId.value)
    if (!hpSuccess) {
      // ignore
    }
    
    const playerInList = playersList.value.find(p => p.id === playerId.value)
    if (playerInList) playerInList.hp = 0
    
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
  // 1. 人数のチェック
  if (playersList.value.length <= 1) {
    alert('他のプレイヤーが退出したため、部屋を解散してトップへ戻ります🏠');
    if (typeof goBackToTop === 'function') await goBackToTop();
    return;
  }
  
  // 2. 再戦フロー（ロビーへ戻る）
  if (isHost.value) {
    try {
      isJudging.value = true;
      
      // 履歴の削除
      await supabase.from('words').delete().eq('room_id', roomId.value);
      
      // 部屋の設定から初期HPを安全に取得（取得できない場合は3）
      const defaultHp = roomData.value?.initial_hp || 3;
      
      // ローカルのHPを即座に回復（ドクロ画面の誤表示を完全に防ぐ）
      if (myPlayer.value) {
        myPlayer.value.hp = defaultHp;
      }

      // DBの全プレイヤーのHPリセット
      const hpUpdates = playersList.value.map(p => 
        supabase.from('players').update({ hp: defaultHp }).eq('id', p.id)
      );
      await Promise.all(hpUpdates);
      
      // 部屋の状態をロビーに戻し、ターンをリセット
      await supabase.from('rooms').update({ 
        status: 'waiting',
        current_turn_index: 0
      }).eq('id', roomId.value);
      
      // フロントエンドのUI切り替えを確実に行う
      currentMode.value = 'lobby';
      currentState.value = 'waiting';
      
    } catch (error) {
      console.error('Play Again Error:', error);
      alert('リセット処理中にエラーが発生しました');
    } finally {
      isJudging.value = false;
    }
  }
}

const retry = () => {
  currentState.value = 'initial'
  chatData.value = { text: `谺｡縺ｯ縲・{targetLetter.value}縲托ｼ√ｂ縺・ｼ大屓謦ｮ縺｣縺ｦ縺ｿ縺ｦ�萄`, image: null }
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
  return player ? player.name : '荳肴・'
}

const goBackToTop = async () => {
  if (myPlayer.value && myPlayer.value.id) {
    await supabase.from('players').delete().eq('id', myPlayer.value.id);
  }
  await leaveLobby()
  window.location.href = '/'
}
</script>

<template>
  <div v-if="isReconnecting && !isAdminMode" class="fixed top-0 left-0 w-full bg-red-500 text-white text-center py-1 text-xs font-bold z-[200] animate-pulse">
    �藤 謗･邯壹′荳榊ｮ牙ｮ壹〒縺吶ょ・謗･邯壻ｸｭ...
  </div>
  <div v-if="!isAdminMode"
    class="w-full bg-pink-50 flex flex-col items-center p-3 font-bold max-w-md mx-auto relative"
    :class="currentMode === 'play' ? 'h-[100dvh] overflow-hidden' : 'min-h-screen pt-8 pb-12'"
  >
    <!-- Decorative background elements -->
    <div class="absolute top-[-50px] left-[-50px] w-32 h-32 bg-yellow-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob pointer-events-none z-0"></div>
    <div class="absolute top-[20%] right-[-50px] w-32 h-32 bg-cyan-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-2000 pointer-events-none z-0"></div>
    <div class="absolute bottom-[-50px] left-[20%] w-40 h-40 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-4000 pointer-events-none z-0"></div>

    <!-- Recovering Overlay -->
    <div v-if="isRecovering" class="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm text-white">
      <div class="text-6xl mb-4 animate-bounce">�売</div>
      <p class="text-xl font-bold animate-pulse">繧ｲ繝ｼ繝�縺ｫ蠕ｩ蟶ｰ荳ｭ...</p>
    </div>

    <!-- Image Modal -->
    <div v-if="selectedImage" class="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm transition-opacity" @click="selectedImage = null">
      <div class="relative w-full max-w-sm">
        <img :src="selectedImage" class="w-full rounded-2xl border-4 border-white shadow-2xl object-contain max-h-[80vh]" />
        <button class="absolute -top-4 -right-4 w-10 h-10 bg-pink-500 text-white rounded-full border-2 border-white shadow-lg flex items-center justify-center text-xl font-black">ﾃ・/button>
      </div>
    </div>

    <!-- RULE CREATE SCREEN -->
    <template v-if="currentMode === 'rule-create'">
      <div class="z-10 flex flex-col items-center justify-center flex-1 w-full gap-6 my-auto py-4">
        <h1 class="text-3xl text-slate-800 drop-shadow-sm font-black tracking-wide text-center leading-tight">
          縺ｩ繧薙↑繝ｫ繝ｼ繝ｫ縺ｮ<br>繧ｲ繝ｼ繝�縺ｫ縺吶ｋ・溟洟・        </h1>
        
        <div class="w-full max-w-sm flex flex-col gap-4">
          <textarea 
            v-model="userRuleRequest" 
            placeholder="萓・ 繧ｵ繧､繝舌・繝代Φ繧ｯ鬚ｨ縺ｮ荳也阜縺ｫ縺ゅｋ繧ゅ・髯仙ｮ夲ｼ√→縺九∬ｵ､縺・ｂ縺ｮ縺�縺托ｼ√↑縺ｩ" 
            class="w-full p-4 rounded-2xl border-4 border-slate-800 shadow-[0_4px_0_0_#1e293b] text-lg focus:outline-none focus:border-cyan-500 h-32 resize-none"
          ></textarea>
          
          <button 
            @click="generateRule"
            :disabled="!userRuleRequest.trim() || isGeneratingRule"
            class="w-full py-4 rounded-2xl text-xl text-white bg-cyan-500 hover:bg-cyan-400 shadow-[0_6px_0_0_#0891b2] transition-all disabled:opacity-50 active:translate-y-[6px] active:shadow-none"
          >
            {{ isGeneratingRule ? 'AI縺瑚・∴荳ｭ...�眺' : 'AI縺ｫ繝ｫ繝ｼ繝ｫ繧剃ｽ懊▲縺ｦ繧ゅｉ縺・惠' }}
          </button>
          
          <div v-if="generatedRule" class="bg-white p-4 rounded-2xl border-4 border-pink-400 shadow-md">
            <h3 class="text-xl font-black text-pink-500 mb-2">{{ generatedRule.title }}</h3>
            <div class="text-sm text-slate-700 space-y-2 font-bold">
              <p><span class="text-slate-500">笨・譚｡莉ｶ:</span> {{ generatedRule.theme_condition }}</p>
              <p><span class="text-slate-500">笶・NG:</span> {{ generatedRule.forbidden_elements }}</p>
            </div>
            <button 
              @click="confirmRule"
              class="w-full py-3 mt-4 rounded-xl text-lg text-white bg-pink-500 hover:bg-pink-400 shadow-[0_4px_0_0_#be185d] transition-all active:translate-y-[4px] active:shadow-none"
            >
              縺薙・繝ｫ繝ｼ繝ｫ縺ｧ驛ｨ螻九ｒ菴懊ｋ�式
            </button>
          </div>
          
          <button 
            @click="skipRule"
            class="w-full py-3 mt-2 rounded-2xl text-lg text-slate-500 bg-transparent hover:bg-slate-100 transition-all font-bold underline"
          >
            繝医ャ繝礼判髱｢縺ｫ謌ｻ繧・�漠
          </button>
        </div>
      </div>
    </template>

    <!-- JOIN SCREEN -->
    <template v-else-if="currentMode === 'join'">
      <button @click="showHowToPlayModal = true" class="absolute top-4 right-4 z-50 bg-white border-2 border-slate-800 rounded-full px-4 py-1.5 text-sm font-bold shadow-[0_4px_0_0_#1e293b] active:shadow-none active:translate-y-[4px] text-slate-700 transition-all flex items-center gap-1"><span>�当</span>驕翫・譁ｹ</button>
      <div class="z-10 flex flex-col items-center justify-center flex-1 w-full gap-8 my-auto py-4">
        <h1 class="text-4xl text-slate-800 drop-shadow-sm tracking-wide text-center leading-tight">
          繝ｬ繝ｳ繧ｺ縺励ｊ縺ｨ繧・br><span class="text-cyan-500 text-5xl">繧ｪ繝ｳ繝ｩ繧､繝ｳ</span>
        </h1>
        <p class="text-slate-600 text-center text-sm">AI縺ｨ荳邱偵↓縲√∩繧薙↑縺ｧ蜀咏悄縺励ｊ縺ｨ繧奇ｼ・/p>
        
        <div class="flex flex-col items-center gap-4 mt-4 w-full max-w-[280px]">
          <div class="w-full">
            <label class="block text-slate-700 text-sm mb-1 ml-1">繝励Ξ繧､繝､繝ｼ蜷・(10譁・ｭ嶺ｻ･蜀・</label>
            <input type="text" v-model="playerName" maxlength="10" placeholder="縺ｪ縺ｾ縺医ｒ縺・ｌ縺ｦ縺ｭ" class="w-full p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] text-center text-lg focus:outline-none focus:border-cyan-500" />
          </div>

          <div v-if="!roomId" class="w-full mt-2">
            <label class="block text-slate-700 text-sm mb-1 ml-1">髮｣譏灘ｺｦ</label>
            <select v-model="difficulty" class="w-full p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] text-center text-lg focus:outline-none focus:border-cyan-500 bg-white cursor-pointer appearance-none">
              <option value="easy">蛻晉ｴ・�伐</option>
              <option value="normal">荳ｭ邏・箝撰ｸ・/option>
              <option value="hard">荳顔ｴ・�櫨</option>
            </select>
          </div>

          <div v-if="!roomId" class="w-full mt-2">
            <label class="block text-slate-700 text-sm mb-1 ml-1">蛻晄悄HP (繝ｩ繧､繝・ 笶､・・/label>
            <select v-model="initialHp" class="w-full p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] text-center text-lg focus:outline-none focus:border-cyan-500 bg-white cursor-pointer appearance-none">
              <option :value="1">1</option>
              <option :value="3">3</option>
              <option :value="5">5</option>
              <option :value="10">10</option>
            </select>
          </div>
          <div v-if="!roomId" class="w-full mt-2">
            <label class="block text-slate-700 text-sm mb-1 ml-1">螳壼藤 (2縲・莠ｺ) �則</label>
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




          <div class="space-y-2 mt-4">
            <button type="button" class="flex items-center justify-start w-full bg-white p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] gap-2 cursor-pointer text-left focus:outline-none" @click="isAgreed = !isAgreed">
              <div class="w-6 h-6 rounded border-2 border-slate-800 flex items-center justify-center shrink-0 transition-colors pointer-events-none" :class="isAgreed ? 'bg-cyan-500 border-cyan-500' : 'bg-white'">
                <span v-if="isAgreed" class="text-white text-sm font-black">笨・/span>
              </div>
              <div class="text-slate-700 text-sm font-bold leading-tight flex-1 pointer-events-none">
                <span @click.stop="showRulesModal = true" class="text-cyan-600 underline pointer-events-auto active:text-cyan-400 p-1 -m-1">蛻ｩ逕ｨ繝ｫ繝ｼ繝ｫ繝ｻ螳牙・繧ｬ繧､繝・/span> 縺ｫ蜷梧э縺吶ｋ
              </div>
            </button>

            <button type="button" class="flex items-center justify-start w-full bg-white p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] gap-2 cursor-pointer text-left focus:outline-none" @click="isPrivacyAgreed = !isPrivacyAgreed">
              <div class="w-6 h-6 rounded border-2 border-slate-800 flex items-center justify-center shrink-0 transition-colors pointer-events-none" :class="isPrivacyAgreed ? 'bg-cyan-500 border-cyan-500' : 'bg-white'">
                <span v-if="isPrivacyAgreed" class="text-white text-sm font-black">笨・/span>
              </div>
              <div class="text-slate-700 text-sm font-bold leading-tight flex-1 pointer-events-none">
                <span @click.stop="showPrivacyPolicyModal = true" class="text-cyan-600 underline pointer-events-auto active:text-cyan-400 p-1 -m-1">繝励Λ繧､繝舌す繝ｼ繝昴Μ繧ｷ繝ｼ</span> 繧堤｢ｺ隱阪＠縺・              </div>
            </button>
          </div>

          <button 
            v-if="!roomId"
            @click="currentMode = 'rule-create'"
            class="w-full py-4 mt-4 rounded-2xl text-xl text-white bg-purple-500 hover:bg-purple-400 shadow-[0_6px_0_0_#9333ea] transition-all duration-150 active:translate-y-[6px] active:shadow-none"
          >
            迚ｹ蛻･繝ｫ繝ｼ繝ｫ繧剃ｽ懈・縺吶ｋ笨ｨ
          </button>

          <button 
            v-if="!roomId"
            @click="joinRandomRoom"
            :disabled="!playerName.trim() || isJoining || !isAgreed || !isPrivacyAgreed"
            class="w-full py-4 mt-4 rounded-2xl text-xl text-white bg-pink-500 hover:bg-pink-400 shadow-[0_6px_0_0_#be185d] transition-all duration-150 disabled:opacity-50 disabled:shadow-none disabled:translate-y-[6px] active:translate-y-[6px] active:shadow-none"
          >
            <span v-if="isJoining">騾壻ｿ｡荳ｭ...</span>
            <span v-else>遏･繧峨↑縺・ｺｺ縺ｨ驕翫・�脂</span>
          </button>

          <button 
            @click="joinOrCreateRoom"
            :disabled="!playerName.trim() || isJoining || !isAgreed || !isPrivacyAgreed"
            class="w-full py-4 mt-2 rounded-2xl text-xl text-slate-800 shadow-[0_6px_0_0_#ca8a04] transition-all duration-150 disabled:opacity-50 disabled:shadow-none disabled:translate-y-[6px]"
            :class="!roomId ? 'bg-yellow-400 hover:bg-yellow-300 active:shadow-[0_0px_0_0_#ca8a04] active:translate-y-[6px]' : 'bg-cyan-400 hover:bg-cyan-300 text-white shadow-[0_6px_0_0_#0891b2] active:shadow-[0_0px_0_0_#0891b2] active:translate-y-[6px]'"
          >
            <span v-if="isJoining">騾壻ｿ｡荳ｭ...</span>
            <span v-else>{{ !roomId ? '蜿矩＃縺ｨ驕翫・�､・ : '驛ｨ螻九↓蜿ょ刈�､・ }}</span>
          </button>
        </div>
        <footer class="mt-6 flex flex-col gap-2 items-center">
          <div class="flex items-center gap-4">
            <a href="#" @click.prevent="showRulesModal = true" class="text-xs text-slate-500 underline hover:text-slate-700 font-bold">蛻ｩ逕ｨ繝ｫ繝ｼ繝ｫ繝ｻ螳牙・繧ｬ繧､繝解沐ｰ</a>
            <a href="https://forms.gle/YXWKWkTRPWFBArfo7" target="_blank" rel="noopener noreferrer" class="text-xs text-slate-500 underline hover:text-slate-700 font-bold">縺疲э隕九・縺雁撫縺・粋繧上○ �動</a>
          </div>
          <a href="https://note.com/jazzy_begin" target="_blank" rel="noopener noreferrer" class="text-[12px] text-slate-500 hover:text-cyan-600 font-medium tracking-widest underline decoration-slate-300 underline-offset-4">&copy; United Make Associates</a>
        </footer>
      </div>
    </template>

    <!-- LOBBY SCREEN -->
    <template v-else-if="currentMode === 'lobby'">
      <div class="z-10 flex flex-col items-center justify-center flex-1 w-full gap-4 max-w-sm my-auto py-4">
        <h2 class="text-2xl text-slate-800 font-black mb-2">蠕・ｩ溘Ο繝薙・ �寞・・/h2>
        
        <div v-if="currentRule" class="w-full bg-pink-100 rounded-2xl border-4 border-pink-400 shadow-sm p-3 mb-2 text-center">
          <p class="text-xs font-black text-pink-500 mb-1">迴ｾ蝨ｨ縺ｮ迚ｹ蛻･繝ｫ繝ｼ繝ｫ</p>
          <p class="text-lg font-bold text-slate-800">{{ currentRule.title }}</p>
        </div>

        <div class="w-full bg-white rounded-2xl border-4 border-slate-800 shadow-[0_6px_0_0_#1e293b] p-4 flex flex-col gap-3">
          <h3 class="text-slate-500 text-sm text-center border-b-2 border-dashed border-slate-200 pb-2">迴ｾ蝨ｨ縺ｮ蜿ょ刈閠・({{ playersList.length }}/{{ roomMaxPlayers }})</h3>
          <ul class="space-y-2">
            <li v-for="(p, idx) in playersList" :key="p.id" class="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border-2 border-slate-200" :class="{'opacity-50 grayscale': p.hp <= 0}">
              <span class="w-6 h-6 rounded-full bg-cyan-400 text-white flex items-center justify-center text-xs shrink-0">{{ idx + 1 }}</span>
              <span class="text-slate-800 truncate flex-1" :class="{'line-through': p.hp <= 0}">
                {{ p.name }} <span v-if="p.is_cpu" class="text-xs">�､・/span>
              </span>
              <span class="text-xs tracking-widest text-pink-500 shrink-0">{{ '笶､・・.repeat(p.hp || 0) }}{{ '�巳'.repeat(Math.max(0, initialHp - (p.hp || 0))) }}</span>
              <span v-if="!isPublicRoom && p.id === hostId" class="text-[10px] bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded-full shrink-0">繝帙せ繝・/span>
              <span v-if="isPublicRoom && p.is_ready && !p.is_cpu" class="text-[10px] bg-green-400 text-white px-2 py-0.5 rounded-full shrink-0 font-bold">笨・貅門ｙOK</span>
            </li>
            <li v-if="playersList.length === 0" class="text-center text-slate-400 text-sm py-4">隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ...</li>
          </ul>
        </div>
        
        <p v-if="isPublicRoom && countdownTime !== null" class="text-pink-500 font-bold text-lg animate-pulse mt-4">繧ｲ繝ｼ繝�髢句ｧ九∪縺ｧ縺ゅ→ {{ countdownTime }}遘・..</p>
        <p v-else-if="isPublicRoom && playersList.length < 2" class="text-slate-500 text-sm animate-pulse mt-4">莉悶・繝励Ξ繧､繝､繝ｼ繧貞ｾ・▲縺ｦ縺・∪縺・..・・莠ｺ莉･荳翫〒繧ｹ繧ｿ繝ｼ繝亥庄閭ｽ・・ｼ・/p>
        <p v-else-if="isPublicRoom && playersList.length >= 2" class="text-pink-500 font-bold text-sm animate-pulse mt-4">貅門ｙ縺後〒縺阪◆繧峨・繧ｿ繝ｳ繧呈款縺励※縺上□縺輔＞・・/p>
        <p v-else-if="!isHost" class="text-slate-500 text-sm animate-pulse mt-4">繝帙せ繝医′髢句ｧ九☆繧九・繧貞ｾ・▲縺ｦ縺・∪縺・..</p>
        
        <div class="w-full flex flex-col gap-2 mt-4">
          <button 
            v-if="!isPublicRoom && isHost"
            @click="addCpuPlayer"
            :disabled="playersList.length >= roomMaxPlayers"
            class="w-full py-3 mb-2 rounded-2xl text-lg text-slate-800 bg-yellow-400 border-4 border-slate-800 shadow-[0_4px_0_0_#1e293b] hover:bg-yellow-300 transition-all active:translate-y-[4px] active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-[0_4px_0_0_#1e293b]"
          >
            CPU縺ｨ1莠ｺ縺ｧ驕翫・�､・          </button>

          <button 
            v-if="!isPublicRoom"
            @click="shareRoomLink"
            :disabled="playersList.length >= roomMaxPlayers"
            class="w-full py-4 rounded-2xl text-xl text-slate-800 bg-white border-4 border-slate-800 shadow-[0_6px_0_0_#1e293b] transition-all duration-150 active:shadow-none active:translate-y-[6px] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-[0_6px_0_0_#1e293b]"
          >
            蜿矩＃繧呈魚蠕・☆繧愚沐・          </button>
          
          <button 
            v-if="isPublicRoom"
            @click="toggleReady"
            class="w-full py-4 rounded-2xl text-xl text-white transition-all duration-150 active:shadow-none active:translate-y-[6px]"
            :class="myPlayer?.is_ready ? 'bg-green-500 hover:bg-green-400 shadow-[0_6px_0_0_#15803d]' : 'bg-pink-500 hover:bg-pink-400 shadow-[0_6px_0_0_#be185d]'"
          >
            {{ myPlayer?.is_ready ? '貅門ｙ繧貞叙繧頑ｶ医☆ 笶・ : '貅門ｙ螳御ｺ・☆繧・笨ｨ' }}
          </button>

          <button 
            v-if="!isPublicRoom && isHost"
            @click="startGame"
            :disabled="playersList.length < 1"
            class="w-full py-4 rounded-2xl text-xl text-white bg-pink-500 hover:bg-pink-400 shadow-[0_6px_0_0_#be185d] transition-all duration-150 active:shadow-none active:translate-y-[6px] disabled:opacity-50 disabled:shadow-none disabled:translate-y-[6px]"
          >
            繧ｲ繝ｼ繝�繧ｹ繧ｿ繝ｼ繝茨ｼ≫惠
          </button>

          <button 
            @click="goBackToTop"
            class="w-full py-3 mt-2 rounded-2xl text-lg text-slate-500 bg-transparent hover:bg-slate-100 transition-all duration-150"
          >
            騾蜃ｺ縺吶ｋ �坎
          </button>
        </div>
        <footer class="mt-6 flex flex-col gap-2 items-center">
          <div class="flex items-center gap-4">
            <a href="#" @click.prevent="showRulesModal = true" class="text-xs text-slate-500 underline hover:text-slate-700 font-bold">蛻ｩ逕ｨ繝ｫ繝ｼ繝ｫ繝ｻ螳牙・繧ｬ繧､繝解沐ｰ</a>
            <a href="https://forms.gle/YXWKWkTRPWFBArfo7" target="_blank" rel="noopener noreferrer" class="text-xs text-slate-500 underline hover:text-slate-700 font-bold">縺疲э隕九・縺雁撫縺・粋繧上○ �動</a>
          </div>
          <a href="https://note.com/jazzy_begin" target="_blank" rel="noopener noreferrer" class="text-[12px] text-slate-500 hover:text-cyan-600 font-medium tracking-widest underline decoration-slate-300 underline-offset-4">&copy; United Make Associates</a>
        </footer>
      </div>
    </template>

    <!-- HISTORY SCREEN -->
    <template v-else-if="currentMode === 'history'">
      <div class="z-20 flex flex-col flex-1 w-full pb-4">
        <h2 class="text-2xl text-center mb-4 text-slate-800 shrink-0 drop-shadow-sm mt-2">縺励ｊ縺ｨ繧雁ｱ･豁ｴ �糖</h2>
        <div class="flex-1 space-y-3 pr-1 pb-4">
           <div v-if="historyList.length === 0" class="text-center text-slate-500 mt-10">縺ｾ縺�螻･豁ｴ縺後≠繧翫∪縺帙ｓ</div>
           <div 
             v-for="(item, index) in historyList" 
             :key="item.id || index" 
             class="bg-white p-3 rounded-2xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] flex flex-col gap-2 items-start"
             :class="{'border-red-500 shadow-[0_4px_0_0_#ef4444]': item.next_char === '繧・}"
           >
              <div class="flex items-center gap-2 w-full">
                <span class="text-xs text-slate-400 font-black shrink-0">#{{ index + 1 }}</span>
                <p class="text-lg leading-tight truncate text-cyan-600 flex-1" :class="{'text-red-500': item.next_char === '繧・}">
                  {{ item.detected_word }} <span class="text-sm text-slate-400">({{ item.reading }})</span>
                </p>
              </div>
              <div class="w-full">
                <p class="text-xs text-slate-600 line-clamp-3 leading-snug">{{ item.comment }}</p>
                <div class="flex justify-between items-end mt-1">
                  <p v-if="item.player_id" class="text-[10px] text-slate-400 font-medium">�側 {{ getPlayerName(item.player_id) }}</p>
                  <button v-if="item.player_id && item.player_id !== playerId" @click="openReport(item.player_id, item.id)" class="text-[10px] text-red-400 underline hover:text-red-500 font-bold">�圷 騾壼�ｱ</button>
                </div>
              </div>
           </div>
        </div>
        <div class="shrink-0 pt-2 pb-1 flex gap-2">
          <button @click="goBackToPrevious" class="flex-1 py-3 bg-white text-slate-800 rounded-2xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] active:translate-y-[4px] active:shadow-none transition-all text-sm">蜑阪・逕ｻ髱｢縺ｸ謌ｻ繧愚沐・/button>
          <button @click="goBackToTop" class="flex-1 py-3 bg-white text-slate-800 rounded-2xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] active:translate-y-[4px] active:shadow-none transition-all text-sm">繝医ャ繝励∈謌ｻ繧愚沛�</button>
        </div>
      </div>
    </template>

    <!-- PLAY SCREEN -->
    <template v-else>
      <header v-if="currentState !== 'gameover' && currentState !== 'clear'" class="w-full text-center shrink-0 my-1 z-10 flex flex-col items-center relative">
        <div class="mb-2 flex flex-wrap items-center justify-center gap-2">
          <div class="px-4 py-1 rounded-full border-2 border-slate-800 bg-white shadow-sm font-black text-sm" :class="isMyTurn ? 'text-pink-500 border-pink-500' : 'text-slate-600'">
            莉翫・ {{ activePlayer?.name }} 縺ｮ繧ｿ繝ｼ繝ｳ・・          </div>
          <div class="px-3 py-1 rounded-full border-2 border-slate-800 bg-white shadow-sm font-black text-xs text-slate-600">
            髮｣譏灘ｺｦ: {{ roomDifficulty === 'easy' ? '蛻晉ｴ夸沐ｰ' : (roomDifficulty === 'hard' ? '荳顔ｴ夸沐･' : '荳ｭ邏壺ｭ撰ｸ・) }}
          </div>
        </div>
        <div class="mb-1 flex flex-wrap items-center justify-center gap-2">
          <div v-if="myPlayer" class="text-sm font-black text-slate-700 bg-white/70 px-3 py-0.5 rounded-full border-2 border-white shadow-sm">
            閾ｪ蛻・・HP: {{ '笶､・・.repeat(myPlayer.hp) }}{{ '�巳'.repeat(Math.max(0, initialHp - myPlayer.hp)) }}
          </div>
          <button v-if="(myPlayer?.hp || 0) > 0" @click="surrender" class="px-2 py-0.5 bg-white border-2 border-slate-800 rounded-lg text-xs font-black shadow-[0_2px_0_0_#1e293b] text-slate-600 active:translate-y-[2px] active:shadow-none transition-all">髯榊盾�承・・/button>
        </div>
        <h1 class="text-xl text-slate-800 drop-shadow-sm tracking-wide">
          谺｡縺ｯ縲√・span class="text-3xl text-cyan-500 drop-shadow-md">{{ targetLetter }}</span> 縲代°繧会ｼÅ沒ｸ
        </h1>
        <p v-if="currentRule" class="text-xs font-black text-pink-500 bg-pink-100 px-3 py-1 mt-1 rounded-full border border-pink-300">
          繝ｫ繝ｼ繝ｫ: {{ currentRule.title }}
        </p>
      </header>

      <main class="w-full flex-grow min-h-0 relative z-10 mb-2 flex flex-col">
        <div class="relative w-full h-full rounded-3xl shadow-inner border-4 border-white overflow-hidden flex flex-col items-center justify-center"
             :class="(currentState === 'gameover' || currentState === 'clear') ? 'bg-red-50' : 'bg-slate-900'">
             
          <template v-if="currentState === 'gameover' || currentState === 'clear'">
            <div class="w-full h-full flex flex-col items-center justify-center p-6 text-center animate-pulse-once">
               <h2 class="text-5xl mb-2 drop-shadow-md transform -rotate-3 font-black tracking-widest" :class="currentState === 'clear' ? 'text-yellow-400' : 'text-red-500'">{{ currentState === 'clear' ? 'GAME CLEAR✨' : 'GAMEOVER' }}</h2>
               <div class="bg-white p-4 rounded-2xl border-4 border-slate-800 shadow-[6px_6px_0_0_#1e293b] my-4 w-full relative">
                 <p class="text-sm text-slate-500 mb-1 font-black">
                   <template v-if="gameOverData?.word === '蜈ｨ貊・">谿句ｿｵ...蜈ｨ蜩｡閼ｱ關ｽ�逐</template>
                   <template v-else-if="gameOverData?.word === '蠑輔″蛻・￠' || gameOverData?.word === '10繧ｿ繝ｼ繝ｳ驕疲・'">縺願ｦ倶ｺ具ｼ・0繧ｿ繝ｼ繝ｳ螳瑚ｵｰ�脂</template>
                   <template v-else-if="gameOverData?.word === '蜆ｪ蜍・ || gameOverData?.word === '繧ｵ繝舌う繝舌Ν蜍晏茜'">蜍晁・ｱｺ螳夲ｼÅ汨・/template>
                   <template v-else>最後の単語（脱落理由）</template>
                 </p>
                 <p class="text-3xl text-slate-800 mb-2 underline decoration-red-500 decoration-4 underline-offset-4">{{ gameOverData?.word }}</p>
                 <p class="text-sm text-slate-600">({{ gameOverData?.reading }})</p>
                 
                 <div v-if="gameOverData?.image" class="mt-4 flex justify-center">
                   <img :src="gameOverData?.image" class="w-32 h-32 object-cover rounded-xl border-2 border-slate-800 shadow-sm cursor-pointer" @click="selectedImage = gameOverData?.image" />
                 </div>
               </div>
               <p class="text-sm text-slate-700 bg-white/80 p-3 rounded-xl border-2 border-red-200">{{ gameOverData?.comment }}</p>
               <button v-if="activePlayer?.id && activePlayer?.id !== playerId" @click="openReport(activePlayer?.id)" class="mt-4 text-sm text-red-500 underline decoration-red-300 hover:text-red-600 font-bold bg-white/80 px-3 py-1 rounded-lg">�圷 縺薙・邨先棡繧貞�ｱ蜻翫☆繧・/button>
            </div>
          </template>
          
          <template v-else>
            <div v-if="(playersList.find(p => p.id === playerId)?.hp || 0) <= 0 && currentState !== 'gameover' && currentState !== 'clear'" class="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center z-[15] p-4 text-center backdrop-blur-sm">
              <div class="text-6xl mb-4">�逐</div>
              <p class="text-white text-2xl font-black mb-2 text-red-400">縺ゅ↑縺溘・閼ｱ關ｽ縺励∪縺励◆...</p>
              <p class="text-slate-300 text-sm mb-8">莉悶・繝励Ξ繧､繝､繝ｼ縺ｮ隕ｳ謌ｦ荳ｭ �操</p>
              <button @click="goBackToTop" class="px-6 py-3 bg-slate-700 text-white font-bold rounded-2xl border-2 border-slate-500 shadow-[0_4px_0_0_#475569] active:shadow-none active:translate-y-[4px] transition-all">
                繝医ャ繝励∈謌ｻ繧具ｼ磯蜃ｺ・解沛�
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
              <div class="w-16 h-16 mb-4 rounded-full bg-cyan-400 border-2 border-white flex items-center justify-center text-3xl animate-bounce">�操</div>
              <p class="text-white text-lg">{{ activePlayer?.name }} 縺ｮ蛻､螳壼ｾ・■...</p>
            </div>

            <div v-if="currentState === 'processing'" class="absolute inset-0 bg-slate-800/40 backdrop-blur-sm flex items-center justify-center z-20">
              <div class="w-full h-1 bg-cyan-400 shadow-[0_0_15px_5px_rgba(34,211,238,0.5)] absolute top-0 animate-scan"></div>
            </div>
            
            <div v-if="showCameraWarning" class="absolute top-4 left-0 right-0 z-50 flex justify-center animate-fade-in-up pointer-events-none px-4">
              <div class="bg-slate-900/90 text-white text-xs sm:text-sm font-bold px-4 py-3 rounded-2xl shadow-lg border border-slate-700 flex flex-col items-center gap-1">
                <div class="flex items-center gap-2">
                  <span>笞�・・/span>
                  <span>莉紋ｺｺ繧・倶ｺｺ諠・�ｱ縺悟・繧願ｾｼ縺ｾ縺ｪ縺・ｈ縺・ｳｨ諢上＠縺ｦ縺ｭ・・/span>
                </div>
                <div class="text-[10px] text-slate-300">窶ｻ繧ｲ繝ｼ繝�縺ｮ縺溘ａ縺ｫ蜊ｱ髯ｺ縺ｪ蝣ｴ謇縺ｸ蜈･繧峨↑縺・〒縺上□縺輔＞</div>
              </div>
            </div>

            <div v-if="wordAnimationData" class="absolute inset-0 flex flex-col items-center justify-center z-[60] pointer-events-none px-4 drop-shadow-2xl">
              <div class="bg-white/95 px-8 py-6 rounded-3xl border-4 border-cyan-400 transform -rotate-3 text-center shadow-[0_10px_25px_-5px_rgba(0,0,0,0.5)] animate-fade-in-up">
                <p class="text-sm font-black text-slate-500 tracking-widest mb-1">{{ wordAnimationData.reading }}</p>
                <p class="text-5xl font-black text-slate-800 tracking-wider">縲施{ wordAnimationData.word }}縲・/p>
              </div>
            </div>
            
            <canvas ref="canvasRef" class="hidden"></canvas>
          </template>
        </div>
      </main>

      <div v-if="currentState !== 'gameover'" class="w-full shrink-0 mb-3 z-10">
        <div class="flex items-end gap-2">
          <div class="w-10 h-10 rounded-full bg-cyan-100 border-2 border-cyan-400 flex items-center justify-center text-xl shadow-sm shrink-0">�､・/div>
          <div class="relative bg-white text-slate-700 p-3 rounded-2xl rounded-bl-none shadow-md border-2 border-slate-100 text-sm sm:text-base flex-1 max-h-[90px] overflow-y-auto flex gap-3">
            <div class="flex-1">
              <p class="leading-relaxed whitespace-pre-wrap">{{ chatData.text }}</p>
              <div v-if="currentState === 'processing'" class="mt-2 flex space-x-2">
                <div class="w-2.5 h-2.5 bg-cyan-400 rounded-full animate-bounce"></div>
                <div class="w-2.5 h-2.5 bg-yellow-400 rounded-full animate-bounce" style="animation-delay: 0.1s"></div>
                <div class="w-2.5 h-2.5 bg-pink-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
              </div>
              <button v-if="chatData.playerId && chatData.playerId !== playerId" @click="openReport(chatData.playerId, chatData.wordId)" class="mt-1 text-[10px] text-red-400 underline hover:text-red-500 font-bold flex items-center gap-1">
                <span>�圷</span>蝣ｱ蜻翫☆繧・              </button>
            </div>
            <div v-if="chatData.image" class="shrink-0 flex items-center">
              <img :src="chatData.image" class="w-12 h-12 rounded-lg border-2 border-slate-800 object-cover shadow-sm cursor-pointer hover:scale-105 transition-transform" @click="selectedImage = chatData.image" />
            </div>
          </div>
        </div>
      </div>

      <div class="w-full shrink-0 mb-2 z-10 flex flex-col gap-2">
        <template v-if="currentState === 'gameover' || currentState === 'clear'">
          <button @click="viewHistory" class="w-full py-3 rounded-2xl text-lg bg-white text-slate-800 border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] hover:bg-slate-50 transition-all active:translate-y-[4px] active:shadow-none">
            縺ｿ繧薙↑縺ｮ螻･豁ｴ繧定ｦ九ｋ笨ｨ
          </button>
          <button v-if="isHost" @click="resetGame" class="w-full py-3 rounded-2xl text-lg bg-cyan-400 text-white shadow-[0_4px_0_0_#0891b2] hover:bg-cyan-300 transition-all active:translate-y-[4px] active:shadow-none">
            繧ゅ≧荳蝗樣♀縺ｶ・溟沐・(繝帙せ繝医・縺ｿ)
          </button>
          <button @click="goBackToTop" class="w-full py-3 mt-2 rounded-2xl text-lg text-slate-500 bg-transparent hover:bg-slate-100 transition-all duration-150 border-2 border-transparent hover:border-slate-200">
            騾蜃ｺ縺励※繝医ャ繝励∈謌ｻ繧・�坎
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
                {{ currentState === 'processing' ? '蛻､螳壻ｸｭ...' : (isMyTurn ? '縺薙ｌ縺ｧ蜍晁ｲ�・・ｼ≫惠' : '縺ゅ↑縺溘・逡ｪ縺ｧ縺ｯ縺ゅｊ縺ｾ縺帙ｓ') }}
              </span>
            </button>
            
            <button 
              v-if="(currentState === 'initial' || currentState === 'processing') && isMyTurn"
              @click="passMyTurn"
              :disabled="currentState === 'processing'"
              class="w-full py-2 rounded-xl text-sm bg-slate-100 text-slate-500 border-2 border-slate-300 hover:bg-slate-200 transition-all duration-150 active:translate-y-[2px] disabled:opacity-50"
            >
              繝代せ縺吶ｋ (HP繧・豸郁ｲｻ) �暢
            </button>
            
            <button 
              v-if="currentState === 'failure'"
              @click="retry"
              class="w-full py-3 rounded-2xl text-lg bg-orange-400 text-white shadow-[0_4px_0_0_#c2410c] hover:bg-orange-300 transition-all duration-150 active:shadow-none active:translate-y-[4px]"
            >
              謦ｮ繧顔峩縺咀沒ｸ
            </button>
          </div>
        </template>
      </div>
    </template>
    
    <RulesModal :isOpen="showRulesModal" @close="showRulesModal = false" />
    <HowToPlayModal :isOpen="showHowToPlayModal" @close="showHowToPlayModal = false" />
    <PrivacyPolicyModal :isOpen="showPrivacyPolicyModal" @close="showPrivacyPolicyModal = false" />
    <ReportModal :isOpen="showReportModal" @close="showReportModal = false" @submit="handleReportSubmit" />
  </div>
  
  <div v-else-if="isAdminMode && !isAdminAuthenticated" class="min-h-[100dvh] flex items-center justify-center bg-slate-900 p-4">
    <div class="bg-white p-6 rounded-3xl shadow-xl w-full max-w-sm flex flex-col gap-4 border-4 border-slate-800">
      <h2 class="text-xl font-black text-center text-slate-800">邂｡逅・・ｪ崎ｨｼ</h2>
      <input 
        type="password" 
        v-model="adminPasswordInput" 
        placeholder="繝代せ繝ｯ繝ｼ繝峨ｒ蜈･蜉・ 
        class="w-full px-4 py-3 border-2 border-slate-300 rounded-2xl focus:border-cyan-400 outline-none font-bold"
        @keyup.enter="checkAdminPassword"
      />
      <button 
        @click="checkAdminPassword" 
        class="w-full bg-cyan-400 text-white font-bold py-3 rounded-2xl active:translate-y-[4px] active:shadow-none transition-all shadow-[0_4px_0_0_#0891b2] border-2 border-transparent"
      >
        隱崎ｨｼ縺吶ｋ
      </button>
    </div>
  </div>
  
  <AdminPanel v-else-if="isAdminMode && isAdminAuthenticated" />
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

/* スマホでの横揺れ・横スクロールを完全に防止 */
html, body {
  overflow-x: hidden;
  width: 100%;
  position: relative;
  /* iOS Safariのバウンススクロール時の背景色をなじませる（必要に応じて） */
  background-color: #fdf2f8; 
}

#app {
  overflow-x: hidden;
  width: 100%;
}
</style>
