<script setup>
import { ref, onMounted } from 'vue'
import { supabase } from '../supabase'

const email = ref('')
const password = ref('')
const isLoggedIn = ref(false)
const isLoading = ref(false)
const reports = ref([])
const errorMessage = ref('')

const checkAuth = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) {
    isLoggedIn.value = true
    await fetchReports()
  }
}

onMounted(() => {
  checkAuth()
})

const handleLogin = async () => {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.value,
      password: password.value
    })
    if (error) throw error
    isLoggedIn.value = true
    await fetchReports()
  } catch (err) {
    errorMessage.value = err.message
  } finally {
    isLoading.value = false
  }
}

const handleLogout = async () => {
  await supabase.auth.signOut()
  isLoggedIn.value = false
  reports.value = []
}

const fetchReports = async () => {
  isLoading.value = true
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('Failed to fetch reports:', error)
    errorMessage.value = error.message
  } else {
    reports.value = data
  }
  isLoading.value = false
}

const updateStatus = async (reportId, newStatus) => {
  const { error } = await supabase
    .from('reports')
    .update({ status: newStatus, resolved_at: newStatus !== '未対応' ? new Date().toISOString() : null })
    .eq('id', reportId)
    
  if (error) {
    alert('更新に失敗しました: ' + error.message)
  } else {
    await fetchReports()
  }
}

const updateMemo = async (reportId, memo) => {
  const { error } = await supabase
    .from('reports')
    .update({ admin_memo: memo })
    .eq('id', reportId)
    
  if (error) {
    alert('メモの更新に失敗しました: ' + error.message)
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-100 p-4 md:p-8">
    <div class="max-w-5xl mx-auto">
      <div class="flex justify-between items-center mb-8">
        <h1 class="text-2xl font-bold text-slate-800">運営管理パネル - 通報一覧</h1>
        <button v-if="isLoggedIn" @click="handleLogout" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300">
          ログアウト
        </button>
      </div>

      <div v-if="!isLoggedIn" class="bg-white p-8 rounded-2xl shadow-md max-w-md mx-auto">
        <h2 class="text-lg font-bold mb-4">管理者ログイン</h2>
        <div v-if="errorMessage" class="mb-4 p-3 bg-red-100 text-red-600 rounded-lg text-sm">
          {{ errorMessage }}
        </div>
        <form @submit.prevent="handleLogin" class="space-y-4">
          <div>
            <label class="block text-sm font-bold text-slate-700 mb-1">メールアドレス</label>
            <input v-model="email" type="email" class="w-full p-3 border border-slate-300 rounded-xl" required />
          </div>
          <div>
            <label class="block text-sm font-bold text-slate-700 mb-1">パスワード</label>
            <input v-model="password" type="password" class="w-full p-3 border border-slate-300 rounded-xl" required />
          </div>
          <button type="submit" :disabled="isLoading" class="w-full py-3 bg-cyan-500 text-white font-bold rounded-xl hover:bg-cyan-600 disabled:opacity-50">
            {{ isLoading ? 'ログイン中...' : 'ログイン' }}
          </button>
        </form>
      </div>

      <div v-else>
        <div class="bg-white rounded-2xl shadow-md overflow-hidden">
          <div class="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
            <h2 class="font-bold text-slate-700">通報データ (全 {{ reports.length }} 件)</h2>
            <button @click="fetchReports" class="px-3 py-1 bg-cyan-100 text-cyan-700 rounded hover:bg-cyan-200 text-sm">更新</button>
          </div>
          
          <div class="overflow-x-auto">
            <table class="w-full text-sm text-left">
              <thead class="text-xs text-slate-500 bg-slate-50 border-b border-slate-200">
                <tr>
                  <th class="px-4 py-3">日時</th>
                  <th class="px-4 py-3">通報理由</th>
                  <th class="px-4 py-3">対象ID (Player/Word)</th>
                  <th class="px-4 py-3">ステータス</th>
                  <th class="px-4 py-3">管理者メモ</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="report in reports" :key="report.id" class="border-b border-slate-100 hover:bg-slate-50">
                  <td class="px-4 py-3 whitespace-nowrap text-slate-500">
                    {{ new Date(report.created_at).toLocaleString('ja-JP') }}
                  </td>
                  <td class="px-4 py-3 font-medium text-slate-800">
                    {{ report.reason }}
                  </td>
                  <td class="px-4 py-3 text-xs text-slate-500 font-mono space-y-1">
                    <div>P: {{ report.target_player_id }}</div>
                    <div>W: {{ report.target_word_id || '-' }}</div>
                    <div title="Room ID">R: {{ report.room_id }}</div>
                  </td>
                  <td class="px-4 py-3">
                    <select 
                      :value="report.status || '未対応'" 
                      @change="updateStatus(report.id, $event.target.value)"
                      class="text-sm border border-slate-300 rounded px-2 py-1 outline-none focus:border-cyan-500"
                      :class="{
                        'bg-red-50 text-red-700': report.status === '未対応' || !report.status,
                        'bg-yellow-50 text-yellow-700': report.status === '確認中',
                        'bg-green-50 text-green-700': report.status === '対応済み',
                        'bg-slate-100 text-slate-600': report.status === '却下'
                      }"
                    >
                      <option value="未対応">未対応</option>
                      <option value="確認中">確認中</option>
                      <option value="対応済み">対応済み</option>
                      <option value="却下">却下</option>
                    </select>
                  </td>
                  <td class="px-4 py-3">
                    <input 
                      type="text" 
                      :value="report.admin_memo" 
                      @blur="updateMemo(report.id, $event.target.value)"
                      placeholder="メモを入力してEnter(Blurで保存)"
                      class="w-full text-sm border border-slate-300 rounded px-2 py-1 outline-none focus:border-cyan-500"
                    />
                  </td>
                </tr>
                <tr v-if="reports.length === 0">
                  <td colspan="5" class="px-4 py-8 text-center text-slate-500">
                    通報データはありません
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
