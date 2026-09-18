import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  try {
    const { imageBase64, lastChar, rule, turnCount, difficulty } = req.body;
    if (!imageBase64 || !lastChar) return res.status(400).json({ error: 'Missing imageBase64 or lastChar' });

    let systemPrompt = `あなたは画像から写っているものを一つ選び、しりとりのルールに従って判定するAIです。
入力された画像について、以下のルールを厳密に判定してください。
1. 「${lastChar}」から始まる単語であること（濁点・半濁点のゆらぎは許容してよい）。
2. 単語は名詞であること。
`;
    
    if (rule && rule.theme_condition) {
      systemPrompt += `3. 特別ルール(必須): ${rule.theme_condition}\n`;
    }
    if (rule && rule.forbidden_elements) {
      systemPrompt += `4. NG条件(存在してはいけない): ${rule.forbidden_elements}\n`;
    }

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
    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Judgment failed' });
  }
}
