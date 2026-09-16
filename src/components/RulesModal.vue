<template>
  <div v-if="isOpen" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm transition-opacity" @click.self="$emit('close')">
    <div class="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden shadow-2xl animate-fade-in-up">
      <div class="p-4 bg-slate-800 text-white font-bold text-lg flex justify-between items-center shrink-0">
        <span>利用ルール・安全ガイド 🔰</span>
        <button @click="$emit('close')" class="text-white hover:text-slate-300 rounded-full w-8 h-8 flex items-center justify-center transition-colors">✕</button>
      </div>
      <div class="p-6 overflow-y-auto flex-1 text-sm text-slate-700 space-y-5 relative">
        <p class="text-pink-500 font-bold border-b-2 border-pink-100 pb-2">皆様に楽しく安全に遊んでいただくため、以下のルールを必ずお守りください。</p>
        
        <div class="space-y-4">
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">🚫</span> 1. 個人情報の撮影禁止</h4>
            <p class="mt-1 pl-7 leading-relaxed">氏名、住所、電話番号、免許証、クレジットカードなど、個人を特定できる情報の撮影は絶対に行わないでください。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">👤</span> 2. 人物の顔の撮影禁止</h4>
            <p class="mt-1 pl-7 leading-relaxed">プライバシー保護のため、自分や他人の顔がはっきりと写り込む写真の投稿はご遠慮ください。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">🔞</span> 3. 不適切なコンテンツの禁止</h4>
            <p class="mt-1 pl-7 leading-relaxed">暴力的、性的、嫌悪感を与える画像、および公序良俗に反する画像の投稿は固く禁じます。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">🤬</span> 4. 嫌がらせや迷惑行為の禁止</h4>
            <p class="mt-1 pl-7 leading-relaxed">他プレイヤーへの誹謗中傷や、ゲームの進行を意図的に妨害するような行為（無関係な画像の連続投稿など）は行わないでください。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">💔</span> 5. 出会い目的の利用禁止</h4>
            <p class="mt-1 pl-7 leading-relaxed">SNSアカウントの交換要求や、不特定多数との出会いを目的とした利用は禁止されています。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">©️</span> 6. 著作権等の権利の尊重</h4>
            <p class="mt-1 pl-7 leading-relaxed">他人の著作物や、撮影が禁止されている場所・物品を無断で撮影して投稿しないようご注意ください。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">🤖</span> 7. AI判定と自動モデレーション</h4>
            <p class="mt-1 pl-7 leading-relaxed">アップロードされた画像はAIによって自動判定されます。不適切と判断された場合は、ゲーム進行中であっても投稿が弾かれる場合があります。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">🚨</span> 8. 通報機能について</h4>
            <p class="mt-1 pl-7 leading-relaxed">不快な画像や迷惑なプレイヤーを見かけた場合は、ゲーム内の「報告する」ボタンから運営へ通報をお願いいたします。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">⚖️</span> 9. アカウント利用制限</h4>
            <p class="mt-1 pl-7 leading-relaxed">ルールの違反が確認された場合、事前の警告なくサービスの利用を制限・停止させていただくことがございます。</p>
          </div>
          <div>
            <h4 class="font-black text-slate-800 flex items-center gap-2"><span class="text-xl">📝</span> 10. ルールの変更と同意</h4>
            <p class="mt-1 pl-7 leading-relaxed">本ルールは予告なく変更される場合があります。本サービスを利用することで、最新のルールに同意したものとみなされます。</p>
          </div>
        </div>
      </div>
      <div class="p-4 border-t border-slate-200 bg-slate-50 shrink-0">
        <button @click="$emit('close')" class="w-full py-3 bg-pink-500 text-white rounded-xl font-bold hover:bg-pink-400 active:translate-y-1 transition-all shadow-[0_4px_0_0_#be185d] active:shadow-none">閉じる</button>
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
