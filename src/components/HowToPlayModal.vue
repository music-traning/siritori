<script setup>
defineProps({ isOpen: Boolean })
defineEmits(['close'])
</script>

<template>
  <div v-if="isOpen" class="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" @click.self="$emit('close')">
    <div class="bg-white rounded-3xl border-4 border-slate-800 shadow-[6px_6px_0_0_#1e293b] w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden animate-fade-in-up">
      <div class="bg-cyan-400 text-slate-900 p-4 border-b-4 border-slate-800 flex justify-between items-center shrink-0">
        <h2 class="text-xl font-black tracking-wide">遊び方 📖</h2>
        <button @click="$emit('close')" class="w-8 h-8 bg-white rounded-full border-2 border-slate-800 flex items-center justify-center font-bold shadow-sm hover:bg-slate-100 active:translate-y-1 active:shadow-none transition-all">✕</button>
      </div>
      
      <div class="p-5 overflow-y-auto space-y-5 text-slate-700 text-sm font-medium">
        <section>
          <h3 class="text-pink-500 font-black text-base border-b-2 border-pink-200 pb-1 mb-2">📸 基本ルール</h3>
          <p class="leading-relaxed">出された文字から始まる「モノ」をカメラで撮影して、しりとりを繋げよう！AIが写真を見て、正しくしりとりができているか判定します🤖✨<br><strong>⚠️注意: スマホやPCの画面を撮影する「デジタル画面の直撮り（ズル）」はAIが弾くので、必ず実物を探してね！</strong></p>
        </section>

        <section>
          <h3 class="text-pink-500 font-black text-base border-b-2 border-pink-200 pb-1 mb-2">❤️ 勝敗とHP（ライフ）</h3>
          <ul class="space-y-2 list-none">
            <li><span class="font-bold text-red-500">✕判定</span>：AIに却下されるとHPが減ります。</li>
            <li><span class="font-bold text-slate-800">💀脱落とサバイバル勝利</span>：HPが0になると脱落。最後まで生き残った1人が優勝！👑</li>
            <li><span class="font-bold text-cyan-600">🎉全員勝利</span>：誰も脱落せずに「0ターン」繋ぎきれば、全員の完全勝利（クリア）です！</li>
            <li><span class="font-bold text-purple-600">😱ゲームオーバー</span>：最後に「ん」がつく言葉を出してしまったらHPが0になって即脱落！全員いなくなったらゲームオーバーです💀</li>
          </ul>
        </section>

        <section>
          <h3 class="text-pink-500 font-black text-base border-b-2 border-pink-200 pb-1 mb-2">⏰ ターンの流れ</h3>
          <p class="leading-relaxed">自分のターンが来たら、<strong class="text-slate-800">60秒以内</strong>に写真を撮ってね。時間切れになると強制的にパス（HP-1）になります。どうしても思いつかない時は、自ら「パス」することも可能です💨</p>
        </section>
      </div>

      <div class="p-4 bg-slate-50 border-t-4 border-slate-800 shrink-0">
        <button @click="$emit('close')" class="w-full py-3 bg-yellow-400 text-slate-800 rounded-2xl font-black border-2 border-slate-800 shadow-[0_4px_0_0_#ca8a04] active:translate-y-[4px] active:shadow-none transition-all">わかった！🙆‍♂️</button>
      </div>
    </div>
  </div>
</template>
