<template>
  <div v-if="isOpen" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm transition-opacity" @click.self="$emit('close')">
    <div class="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden shadow-2xl animate-fade-in-up">
      <div class="p-4 bg-slate-800 text-white font-bold text-lg flex justify-between items-center shrink-0">
        <span>ルール・安全ガイド 🛡️</span>
        <button @click="$emit('close')" class="text-white hover:text-slate-300 rounded-full w-8 h-8 flex items-center justify-center transition-colors">✕</button>
      </div>
      <div class="p-6 overflow-y-auto flex-1 text-sm text-slate-700 space-y-5 relative">
        <p class="text-pink-500 font-bold border-b-2 border-pink-100 pb-2">皆で安全に楽しく遊ぶため、以下のルールを守ろう！</p>
        
        <div class="space-y-4">
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">📺</span> 1. 画面の直撮り禁止（アンチチート）</h4>
            <p class="mt-1 pl-7 leading-relaxed">スマホやPC、テレビなどの「デジタル画面」に映ったものを撮影するズルはAIが検知して弾きます！必ず「実物」を探して撮影してください。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">📸</span> 2. 個人情報の撮影禁止</h4>
            <p class="mt-1 pl-7 leading-relaxed">顔写真、免許証、クレジットカードなど、自分や他人の個人情報が映り込む写真の投稿は厳禁です。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">🚫</span> 3. 不適切なコンテンツの禁止</h4>
            <p class="mt-1 pl-7 leading-relaxed">暴力的、性的な表現、他者を不快にさせる画像や単語の投稿は固く禁じます（AIのセーフティ機能により自動ブロックされます）。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">🤖</span> 4. AI判定とハルシネーション</h4>
            <p class="mt-1 pl-7 leading-relaxed">アップロードされた画像はAIによって判定されます。ごく稀に不正確な判定（AIの勘違い）が行われる場合がありますが、ゲームの一部としてお楽しみください。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">🚨</span> 5. 悪質行為の制限</h4>
            <p class="mt-1 pl-7 leading-relaxed">ルールの意図的な違反が確認された場合、予告なくサービスの利用を制限・停止する場合があります。</p>
          </div>
        </div>
      </div>
      <div class="p-4 border-t border-slate-200 bg-slate-50 shrink-0">
        <button @click="$emit('close')" class="w-full py-3 bg-pink-500 text-white rounded-xl font-bold hover:bg-pink-400 active:translate-y-1 transition-all shadow-[0_4px_0_0_#be185d] active:shadow-none">とじる</button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({ isOpen: Boolean })
defineEmits(['close'])
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
