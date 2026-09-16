<template>
  <div v-if="isOpen" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm transition-opacity" @click.self="$emit('close')">
    <div class="bg-white rounded-2xl w-full max-w-sm flex flex-col overflow-hidden shadow-2xl animate-fade-in-up">
      <div class="p-4 bg-red-500 text-white font-bold text-lg flex justify-between items-center shrink-0">
        <span>報告する 🚨</span>
        <button @click="$emit('close')" class="text-white hover:text-red-200 rounded-full w-8 h-8 flex items-center justify-center transition-colors">✕</button>
      </div>
      <div class="p-4 space-y-4">
        <p class="text-sm text-slate-700">不適切なコンテンツまたは迷惑行為を報告します。理由を選択してください。</p>
        <select v-model="reason" class="w-full p-3 rounded-xl border-2 border-slate-300 focus:outline-none focus:border-red-500">
          <option value="">選択してください</option>
          <option value="個人情報が写っている">個人情報が写っている</option>
          <option value="人の顔が写っている">人の顔が写っている</option>
          <option value="不適切・卑猥な画像">不適切・卑猥な画像（NSFW）</option>
          <option value="暴言・迷惑行為">暴言・嫌がらせ・迷惑行為</option>
          <option value="その他">その他</option>
        </select>
      </div>
      <div class="p-4 border-t bg-slate-50 flex gap-2">
        <button @click="$emit('close')" class="flex-1 py-3 bg-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-300">キャンセル</button>
        <button @click="submit" :disabled="!reason" class="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all">送信</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({ isOpen: Boolean })
const emit = defineEmits(['close', 'submit'])

const reason = ref('')

watch(() => props.isOpen, (newVal) => {
  if (newVal) {
    reason.value = ''
  }
})

const submit = () => {
  emit('submit', reason.value)
}
</script>

<style scoped>
.animate-fade-in-up {
  animation: fadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
