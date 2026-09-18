import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  try {
    const { lastChar, rule, difficulty, usedWords } = req.body;
    if (!lastChar) return res.status(400).json({ error: 'Missing lastChar' });

    let prompt = `あなたはプレイヤーと一緒にしりとりで遊んでいるフレンドリーなAIバディです。
以下の【厳格なルール】に従って、単語を1つ生成してください。

【厳格なルール】
1. 単語のひらがな読みの最初の1文字が「${lastChar}」と完全に一致する単語を絶対に選んでください（濁点・半濁点も厳密に区別すること。言い訳をして別の文字から始めるのは固く禁じます）。
`;
    if (rule && rule.theme_condition) {
      prompt += `2. 特別ルール(必須条件): ${rule.theme_condition}\n`;
    }
    if (rule && rule.forbidden_elements) {
      prompt += `3. NG条件(存在してはいけない): ${rule.forbidden_elements}\n`;
    }
    if (usedWords && usedWords.length > 0) {
      prompt += `4. 以下の単語はすでに使用済みのため、絶対に回答してはならない: ${usedWords.join(', ')}\n`;
    }
    
    prompt += `
【ユーザーへのコメント(comment)のガイドライン】
思考プロセスや言い訳をコメントに出力してごまかすことは固く禁じます。単語の選定ロジックは厳格に行いますが、出力する comment は、一緒に遊んでいる親しみやすいAIバディとしてのセリフにしてください。
- 成功時の例: 「『${lastChar}』だね！じゃあ『〇〇』はどうかな？ 小さくて探すの大変だけどね🤭 次は『〇（最後の文字）』だよ！」
- 条件が厳しすぎて見つからず、「ん」で終わる単語で自爆する場合の例: 「う〜ん、『${lastChar}』から始まってその条件を満たすもの…あっ、『〇〇ん』しか思いつかない！負けちゃった〜🤖💦」
単語を一つ選び、指定されたJSON形式で返答してください。`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detected_word: { type: Type.STRING },
            reading: { type: Type.STRING },
            next_char: { type: Type.STRING },
            comment: { type: Type.STRING, description: "AIらしいメタ的なセリフ" }
          },
          required: ["detected_word", "reading", "next_char", "comment"]
        }
      }
    });

    const result = JSON.parse(response.text);
    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'CPU action failed' });
  }
}
