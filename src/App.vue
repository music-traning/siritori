<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { supabase } from './supabase'
import { initAudio, playShutter, playSuccess, playFailure, playGameOver as _playGameOver } from './audio'

// Global State
const currentMode = ref('join') // 'join', 'lobby', 'play', 'history'
const roomId = ref(null)
const roomStatus = ref('waiting')
const hostId = ref(null)
const roomShareEnabled = ref(false)
const hasPlayedGameOverSound = ref(false)
const isJoining = ref(false)
const isAgreed = ref(false)
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

// Game State
const targetLetter = ref('あ')
const currentState = ref('initial')
const isProcessingGameOver = ref(false)
const chatData = ref({
  text: '準備中...✨',
  image: null
})
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
  for (const channel of activeChannels) {
    await supabase.removeChannel(channel)
  }
  activeChannels.length = 0
}

const startTurnTimeout = () => {
  clearTimeout(turnTimeout)
  if (isMyTurn.value && currentState.value === 'initial') {
    turnTimeout = setTimeout(() => {
      alert('60秒経過したため、自動的にパスしました💨')
      passMyTurn()
    }, 60000)
  }
}

watch([currentTurnIndex, currentState, isMyTurn], () => {
  startTurnTimeout()
})

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
  }
  
  currentMode.value = 'join'
})

onUnmounted(async () => {
  clearTimeout(turnTimeout)
  await cleanupSubscriptions()
  if (stream.value) {
    stream.value.getTracks().forEach(track => track.stop())
  }
})

// --- Join & Lobby Logic ---
const joinRandomRoom = async () => {
  if (isJoining.value) return
  isJoining.value = true
  
  try {
    initAudio()
    if (!playerName.value.trim() || playerName.value.length > 10) return
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
      p_random_char: randomChar
    })

    if (error || !newRoomId) {
      console.error('Random match error:', error)
      alert('マッチングに失敗しました💦')
      return
    }

    roomId.value = newRoomId
    localStorage.setItem('shiritori_player_id', playerId.value)
    
    // ユーザー指示: 再度 SELECT を行い自身のプレイヤー情報を取得しローカルにセット
    const { data: fetchedPlayer, error: fetchErr } = await supabase.from('players').select('*').eq('id', playerId.value).single()
    if (fetchErr) {
      console.error('Player fetch error:', fetchErr)
    } else if (fetchedPlayer) {
      // 重複を防ぐ
      if (!playersList.value.find(p => p.id === fetchedPlayer.id)) {
        playersList.value.push(fetchedPlayer)
      }
    }
    
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
    if (!playerName.value.trim()) return
    if (playerName.value.length > 10) return
    
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
        initial_hp: Number(initialHp.value)
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
  if (roomStatus.value === 'playing') return // 重複実行防止
  
  // 状態をローカルで先に書き換えてロックする
  roomStatus.value = 'playing'
  await supabase.rpc('update_room_status', { p_room_id: roomId.value, p_status: 'playing' })
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
    .update({ is_ready: newReadyState })
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
  // Listen to Rooms (変数 roomChannel に格納)
  const roomChannel = supabase.channel(`rooms-${id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` }, async (payload) => {
    const room = payload.new
    
    // Status change
    if (room.status === 'playing' && currentMode.value === 'lobby') {
      currentMode.value = 'play'
      startCamera()
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
  }).subscribe()

  // Listen to Players (変数 playerChannel に格納)
  const playerChannel = supabase.channel(`players-${id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${id}` }, (payload) => {
    if (payload.eventType === 'INSERT') {
      if (!playersList.value.find(p => p.id === payload.new.id)) {
        playersList.value.push(payload.new)
        playersList.value.sort((a, b) => a.order_index - b.order_index)
      }
    } else if (payload.eventType === 'UPDATE') {
      const idx = playersList.value.findIndex(p => p.id === payload.new.id)
      if (idx !== -1) {
        playersList.value[idx] = payload.new
      }
    }
  }).subscribe()

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
        image: word.image_base64 || null
      }
      currentState.value = 'initial'
      capturedImage.value = null
      if (videoRef.value && isMyTurn.value) videoRef.value.play()
    }
  }).subscribe()

  // 【追加】作成した3つのチャンネルを配列に保存し、unmount時に破棄できるようにする
  activeChannels.push(roomChannel, playerChannel, wordChannel)
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
    await supabase.rpc('update_room_status', { p_room_id: roomId.value, p_status: 'gameover' })
    return true
  }

  if (playersList.value.length > 1 && alivePlayers.length === 1) {
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
    await supabase.rpc('update_room_status', { p_room_id: roomId.value, p_status: 'gameover' })
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
      const { data: { publicUrl } } = supabase.storage.from('shiritori-images').getPublicUrl(fileName);
      return publicUrl;
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
    await supabase.rpc('update_room_status', { p_room_id: roomId.value, p_status: 'gameover' })
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
      await supabase.rpc('update_room_status', { p_room_id: roomId.value, p_status: 'gameover' })
    } else if (result.is_valid) {
      playSuccess()
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
      
      await supabase.rpc('update_room_turn', { 
        p_room_id: roomId.value, 
        p_player_id: playerId.value,
        p_turn_index: getNextTurnIndex(currentTurnIndex.value),
        p_next_char: result.next_char
      })
      
      turnCount.value++
      targetLetter.value = result.next_char
      capturedImage.value = null
      if (videoRef.value) videoRef.value.play()
      currentState.value = 'initial'
    } else {
      playFailure()
      chatData.value = { text: result.comment, image: null }
      const myPlayer = playersList.value.find(p => p.id === playerId.value)
      if (myPlayer) {
        const newHp = Math.max(0, myPlayer.hp - 1)
        await supabase.rpc('update_player_hp', { p_player_id: playerId.value, p_new_hp: newHp })
        myPlayer.hp = newHp
        
        if (newHp <= 0) {
          const isOver = await checkWinCondition()
          if (!isOver) {
            await supabase.rpc('update_room_turn', { 
              p_room_id: roomId.value, 
              p_player_id: playerId.value,
              p_turn_index: getNextTurnIndex(currentTurnIndex.value),
              p_next_char: targetLetter.value
            })
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
  currentState.value = 'processing'
  
  const newHp = Math.max(0, myPlayer.value.hp - 1)
  await supabase.rpc('update_player_hp', { p_player_id: playerId.value, p_new_hp: newHp })
  
  // Update local state BEFORE checking win condition
  const playerInList = playersList.value.find(p => p.id === playerId.value)
  if (playerInList) playerInList.hp = newHp
  
  if (newHp <= 0) {
    const isOver = await checkWinCondition()
    if (!isOver) {
      await supabase.rpc('update_room_turn', { 
        p_room_id: roomId.value, 
        p_player_id: playerId.value,
        p_turn_index: getNextTurnIndex(currentTurnIndex.value),
        p_next_char: targetLetter.value
      })
      currentState.value = 'initial'
    }
  } else {
    chatData.value = { text: `${myPlayer.value.name} がパスしました💨`, image: null }
    await supabase.rpc('update_room_turn', { 
      p_room_id: roomId.value, 
      p_player_id: playerId.value,
      p_turn_index: getNextTurnIndex(currentTurnIndex.value),
      p_next_char: targetLetter.value
    })
    currentState.value = 'initial'
  }
}

const surrender = async () => {
  if (!confirm('本当に降参して部屋を抜けますか？')) return
  if (myPlayer.value && myPlayer.value.hp > 0) {
    await supabase.rpc('update_player_hp', { p_player_id: playerId.value, p_new_hp: 0 })
    
    // Update local state BEFORE checking win condition
    const playerInList = playersList.value.find(p => p.id === playerId.value)
    if (playerInList) playerInList.hp = 0
    
    // Check if the game should end (last man standing / wipeout)
    const isOver = await checkWinCondition()
    if (!isOver && isMyTurn.value) {
      await supabase.rpc('update_room_turn', { 
        p_room_id: roomId.value, 
        p_player_id: playerId.value,
        p_turn_index: getNextTurnIndex(currentTurnIndex.value),
        p_next_char: targetLetter.value
      })
    }
  }
  window.location.href = '/'
}

const resetGame = async () => {
  if (isHost.value) {
    const updates = playersList.value.map(p => supabase.rpc('update_player_hp', { p_player_id: p.id, p_new_hp: initialHp.value }))
    await Promise.all(updates)
    
    await supabase.rpc('reset_room', { p_room_id: roomId.value, p_host_id: playerId.value })
  }
  turnCount.value = 0
  targetLetter.value = 'あ'
  currentState.value = 'initial'
  isProcessingGameOver.value = false
  hasPlayedGameOverSound.value = false
  chatData.value = { text: 'さあ、何撮る？またはやく『あ』から始まるもの見つけてよ😁', image: null }
  capturedImage.value = null
  if (videoRef.value) videoRef.value.play()
  else startCamera()
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

const goBackToTop = () => {
  window.location.href = '/'
}
</script>

<template>
  <div 
    class="w-full bg-pink-50 flex flex-col items-center p-3 font-bold max-w-md mx-auto relative"
    :class="currentMode === 'play' ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh] overflow-x-hidden overflow-y-auto pt-8 pb-4'"
  >
    <!-- Decorative background elements -->
    <div class="absolute top-[-50px] left-[-50px] w-32 h-32 bg-yellow-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob pointer-events-none z-0"></div>
    <div class="absolute top-[20%] right-[-50px] w-32 h-32 bg-cyan-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-2000 pointer-events-none z-0"></div>
    <div class="absolute bottom-[-50px] left-[20%] w-40 h-40 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-4000 pointer-events-none z-0"></div>

    <!-- Image Modal -->
    <div v-if="selectedImage" class="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm transition-opacity" @click="selectedImage = null">
      <div class="relative w-full max-w-sm">
        <img :src="selectedImage" class="w-full rounded-2xl border-4 border-white shadow-2xl object-contain max-h-[80vh]" />
        <button class="absolute -top-4 -right-4 w-10 h-10 bg-pink-500 text-white rounded-full border-2 border-white shadow-lg flex items-center justify-center text-xl font-black">×</button>
      </div>
    </div>

    <!-- JOIN SCREEN -->
    <template v-if="currentMode === 'join'">
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

          <label v-if="!roomId" class="flex items-center justify-between w-full cursor-pointer bg-white p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] mt-2">
            <span class="text-slate-700 text-sm">画像を共有する📸</span>
            <div class="relative">
              <input type="checkbox" v-model="isImageShareEnabled" class="sr-only" />
              <div class="block w-12 h-7 rounded-full border-2 border-slate-800 transition-colors" :class="isImageShareEnabled ? 'bg-cyan-400' : 'bg-slate-300'"></div>
              <div class="absolute left-1 top-1 bg-white w-5 h-5 rounded-full border-2 border-slate-800 transition-transform" :class="{'translate-x-5': isImageShareEnabled}"></div>
            </div>
          </label>

          <label class="flex items-center justify-start w-full cursor-pointer bg-white p-3 rounded-xl border-2 border-slate-800 shadow-[0_4px_0_0_#1e293b] mt-4 gap-2">
            <input type="checkbox" v-model="isAgreed" class="w-5 h-5 rounded border-slate-800 text-cyan-500 focus:ring-cyan-500" />
            <span class="text-slate-700 text-xs font-bold leading-tight flex-1">利用規約とプライバシーポリシーに同意する</span>
          </label>

          <button 
            v-if="!roomId"
            @click="joinRandomRoom"
            :disabled="!playerName.trim() || isJoining || !isAgreed"
            class="w-full py-4 mt-4 rounded-2xl text-xl text-white bg-pink-500 hover:bg-pink-400 shadow-[0_6px_0_0_#be185d] transition-all duration-150 disabled:opacity-50 disabled:shadow-none disabled:translate-y-[6px] active:translate-y-[6px] active:shadow-none"
          >
            <span v-if="isJoining">通信中...</span>
            <span v-else>見知らぬ人と遊ぶ🌐</span>
          </button>

          <button 
            @click="joinOrCreateRoom"
            :disabled="!playerName.trim() || isJoining || !isAgreed"
            class="w-full py-4 mt-2 rounded-2xl text-xl text-slate-800 shadow-[0_6px_0_0_#ca8a04] transition-all duration-150 disabled:opacity-50 disabled:shadow-none disabled:translate-y-[6px]"
            :class="!roomId ? 'bg-yellow-400 hover:bg-yellow-300 active:shadow-[0_0px_0_0_#ca8a04] active:translate-y-[6px]' : 'bg-cyan-400 hover:bg-cyan-300 text-white shadow-[0_6px_0_0_#0891b2] active:shadow-[0_0px_0_0_#0891b2] active:translate-y-[6px]'"
          >
            <span v-if="isJoining">通信中...</span>
            <span v-else>{{ !roomId ? '部屋を作る' : '部屋に参加' }}</span>
          </button>
        </div>
        <footer class="mt-8 text-center">
          <a href="https://note.com/jazzy_begin" target="_blank" rel="noopener noreferrer" class="text-[12px] text-slate-500 hover:text-cyan-600 font-medium tracking-widest underline decoration-slate-300 underline-offset-4">© United Make Associates</a>
        </footer>
      </div>
    </template>

    <!-- LOBBY SCREEN -->
    <template v-else-if="currentMode === 'lobby'">
      <div class="z-10 flex flex-col items-center justify-center flex-1 w-full gap-4 max-w-sm my-auto py-4">
        <h2 class="text-2xl text-slate-800 font-black mb-2">待機ロビー 🛋️</h2>
        <div class="w-full bg-white rounded-2xl border-4 border-slate-800 shadow-[0_6px_0_0_#1e293b] p-4 flex flex-col gap-3">
          <h3 class="text-slate-500 text-sm text-center border-b-2 border-dashed border-slate-200 pb-2">現在の参加者 ({{ playersList.length }}/5)</h3>
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
            :disabled="playersList.length < 2"
            class="w-full py-4 rounded-2xl text-xl text-white transition-all duration-150 active:shadow-none active:translate-y-[6px] disabled:opacity-50 disabled:shadow-none disabled:translate-y-[6px]"
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
        </div>
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
                <p v-if="item.player_id" class="text-[10px] text-slate-400 mt-1 text-right font-medium">👤 {{ getPlayerName(item.player_id) }}</p>
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
  </div>
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
