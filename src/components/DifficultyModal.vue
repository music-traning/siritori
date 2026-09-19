<script setup>
defineProps({
  isOpen: Boolean
})
defineEmits(['close'])
</script>

<template>
  <div v-if="isOpen" class="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-opacity" @click.self="$emit('close')">
    <div class="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl border-4 border-slate-800 relative animate-fade-in-up">
      <button @click="$emit('close')" class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200 font-black">×</button>
      
      <h2 class="text-2xl font-black text-slate-800 mb-4 text-center">難易度について 📊</h2>
      <p class="text-sm text-slate-600 mb-6 text-center font-bold">AI審査員の「強引なこじつけ度」が変わります！</p>
      
      <div class="space-y-4">
        <div class="bg-blue-50 border-2 border-blue-200 p-3 rounded-2xl">
          <p class="font-black text-blue-700 text-lg mb-1">お笑い 🎙️ <span class="text-sm text-blue-600">(こじつけ度: 測定不能)</span></p>
          <p class="text-xs text-slate-700 font-bold leading-relaxed">AIがコテコテの大阪弁漫才師になりきり、無理やりなこじつけ（ボケ）と激しいノリツッコミを披露します。ルール無用の爆笑モードです！</p>
        </div>
        
        <div class="bg-green-50 border-2 border-green-200 p-3 rounded-2xl">
          <p class="font-black text-green-700 text-lg mb-1">初級 🔰 <span class="text-sm text-green-600">(こじつけ度: 80%)</span></p>
          <p class="text-xs text-slate-700 font-bold leading-relaxed">AIのお笑いモード！写真が何であれ、指定の文字に無理やりこじつけて正解にしてくれます。</p>
        </div>
        
        <div class="bg-yellow-50 border-2 border-yellow-200 p-3 rounded-2xl">
          <p class="font-black text-yellow-700 text-lg mb-1">中級 ⭐️ <span class="text-sm text-yellow-600">(こじつけ度: 50%)</span></p>
          <p class="text-xs text-slate-700 font-bold leading-relaxed">半分の確率で強引なこじつけが発生します。笑いと真面目さのバランス型です。</p>
        </div>
        
        <div class="bg-orange-50 border-2 border-orange-200 p-3 rounded-2xl">
          <p class="font-black text-orange-700 text-lg mb-1">上級 🔥 <span class="text-sm text-orange-600">(こじつけ度: 10%)</span></p>
          <p class="text-xs text-slate-700 font-bold leading-relaxed">基本的に厳しめですが、たまーにAIが無理やりなこじつけで助けてくれます。</p>
        </div>
        
        <div class="bg-purple-50 border-2 border-purple-300 p-3 rounded-2xl shadow-inner">
          <p class="font-black text-purple-700 text-lg mb-1">特級 👑 <span class="text-sm text-purple-600">(こじつけ度: 0%)</span></p>
          <p class="text-xs text-slate-700 font-bold leading-relaxed">マジモノのしりとり。一切の妥協やこじつけを許さない、極めて厳格な審査が行われます。</p>
        </div>
      </div>
      
      <button @click="$emit('close')" class="w-full mt-6 py-3 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-700 transition-colors shadow-[0_4px_0_0_#1e293b] active:shadow-none active:translate-y-[4px]">
        閉じる
      </button>
    </div>
  </div>
</template>
