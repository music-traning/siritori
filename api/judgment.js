import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  try {
    const { imageBase64, lastChar, rule, turnCount, difficulty } = req.body;
    if (!imageBase64 || !lastChar) return res.status(400).json({ error: 'Missing imageBase64 or lastChar' });

    let systemPrompt = `あなたは画像に写っているものを判定するAI審査員です。
【厳格な内部ロジック】
入力された画像から単語を1つ抽出し、以下の条件を「全て」満たしているか絶対に妥協せず厳密に判定してください。1つでも満たさない場合、画像に何が写っていようと「絶対に」is_valid: falseとしてください。例外としてtrueにすることは一切許されません。AI特有の忖度はシステム上許されません。
1. 最優先確認事項: 認識した単語のひらがな読みの最初の1文字と「${lastChar}」が、『濁点・半濁点も含めて完全に一致しているか』を必ず確認してください。（例：「ご」に対して「ぎ」や「こ」から始まる単語などは完全なルール違反です）
2. 単語は一般的な名詞であること。
`;
    
    if (rule && rule.theme_condition) {
      systemPrompt += `3. 特別ルール(必須条件): ${rule.theme_condition}\n`;
    }
    if (rule && rule.forbidden_elements) {
      systemPrompt += `4. NG条件(存在してはいけない): ${rule.forbidden_elements}\n`;
    }

    systemPrompt += `
【ユーザーへのコメント(comment)のガイドライン】
内部の判定は非常に厳格に行いますが、プレイヤーへ出力する comment は「極めて優しく、ポップでフレンドリーな親友のようなトーン」にしてください。プレイヤーを決して責めないでください。
- 成功例（is_valid: true）: 「お見事！『${lastChar}』から始まる『〇〇』だね✨ 次もがんばって！」
- 失敗例（is_valid: false）: 「あれれ？『${lastChar}』から始まっていないみたい💦 画像には『〇〇』が写っているよ！もう一回探してみてね📸」
- 特別ルール違反時の失敗例: 「『〇〇』いい感じ！…なんだけど、今回の特別ルールには合ってないみたい🥺 別のものを探してみよう！」
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: [
        systemPrompt,
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "")
          }
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            is_valid: { type: Type.BOOLEAN, description: "しりとりのルールおよび特別ルールを全て満たしているか" },
            detected_word: { type: Type.STRING, description: "画像から判定された単語" },
            reading: { type: Type.STRING, description: "単語のひらがな読み" },
            next_char: { type: Type.STRING, description: "次の人に渡す文字（最後の文字。「ん」や小文字の場合は適切に処理）" },
            comment: { type: Type.STRING, description: "判定理由やプレイヤーへの短いコメント" },
            is_inappropriate: { type: Type.BOOLEAN, description: "不適切な画像(NSFW等)かどうか" }
          },
          required: ["is_valid", "detected_word", "reading", "next_char", "comment", "is_inappropriate"]
        }
      }
    });

    const result = JSON.parse(response.text);
    
    // 強制検算ロジック: AIのハルシネーション対策
    if (result.reading && result.reading.charAt(0) !== lastChar) {
      result.is_valid = false;
      result.comment = `あれれ？『${lastChar}』から始まっていないみたい💦 もう一度探してみてね！`;
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Judgment failed' });
  }
}
