<script setup>
defineProps({
  isOpen: Boolean
})

defineEmits(['close'])
</script>

<template>
  <div v-if="isOpen" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
    <div class="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-fade-in-up">
      <div class="bg-gradient-to-r from-cyan-400 to-blue-500 p-4 shrink-0 relative">
        <h2 class="text-white font-black text-xl text-center">プライバシーポリシー</h2>
        <button @click="$emit('close')" class="absolute right-4 top-4 w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center text-white transition-colors">
          ✕
        </button>
      </div>
      
      <div class="p-6 overflow-y-auto flex-1 space-y-6 text-sm text-slate-700">
        <section>
          <h3 class="font-bold text-lg text-slate-800 mb-2 border-b-2 border-cyan-100 pb-1">1. 取得する情報について</h3>
          <p>本サービスでは、以下の情報を取得・利用します。</p>
          <ul class="list-disc pl-5 mt-2 space-y-1">
            <li>ゲーム内で入力されたプレイヤー名</li>
            <li>カメラを通じて撮影された画像（一時的な判定利用のみ）</li>
            <li>IPアドレスやブラウザの種類などのアクセスログ（インフラ提供者により自動収集）</li>
          </ul>
        </section>

        <section>
          <h3 class="font-bold text-lg text-slate-800 mb-2 border-b-2 border-cyan-100 pb-1">2. 画像は一切保存されません 🛡️</h3>
          <p>
            セキュリティとプライバシー保護のため、<strong>撮影された画像はクラウドやサーバー上に一切保存（アップロード）されません。</strong><br>
            画像はベース64エンコードされた状態で直接Google Gemini APIへ送信され、しりとりの判定が終わると同時に完全に破棄されます。もちろん、AIの学習データとして利用されることもありません。
          </p>
        </section>

        <section>
          <h3 class="font-bold text-lg text-slate-800 mb-2 border-b-2 border-cyan-100 pb-1">3. 外部サービスの利用</h3>
          <p>本サービスは以下の外部インフラを利用して提供されています。</p>
          <ul class="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Vercel</strong>: ホスティングおよびAPIの実行</li>
            <li><strong>Supabase</strong>: データベース（テキストデータのみ）</li>
            <li><strong>Google Gemini API</strong>: AIによる画像および文字判定</li>
          </ul>
        </section>
        
        <section>
          <h3 class="font-bold text-lg text-slate-800 mb-2 border-b-2 border-cyan-100 pb-1">4. 未成年者の注意</h3>
          <p>未成年の方が本サービスを利用する場合は、保護者の方と一緒に利用ルールやプライバシーポリシーを確認し、同意を得た上で遊んでください。</p>
        </section>

        <section>
          <h3 class="font-bold text-lg text-slate-800 mb-2 border-b-2 border-cyan-100 pb-1">5. お問い合わせ</h3>
          <p>本サービスは個人開発により提供されています。お問い合わせ等は、開発者のSNS等からご連絡ください。</p>
        </section>
      </div>

      <div class="p-4 bg-slate-50 border-t border-slate-100 shrink-0 flex justify-center">
        <button @click="$emit('close')" class="w-full sm:w-auto px-8 py-3 bg-cyan-500 hover:bg-cyan-400 text-white font-bold rounded-xl shadow-md transition-colors">
          閉じる
        </button>
      </div>
    </div>
  </div>
</template>
