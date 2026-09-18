import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  try {
    const { lastChar, rule, difficulty } = req.body;
    if (!lastChar) return res.status(400).json({ error: 'Missing lastChar' });

    let prompt = `しりとりで「${lastChar}」から始まる単語を考えてください。`;
    if (rule && rule.theme_condition) {
      prompt += `\n特別ルール: ${rule.theme_condition}`;
    }
    if (rule && rule.forbidden_elements) {
      prompt += `\nNG条件: ${rule.forbidden_elements}`;
    }
    prompt += `\n単語を一つ選び、JSON形式で返答してください。AIらしいメタ的なセリフをcommentに含めてください。条件が厳しすぎる場合は「ん」で終わる単語で自爆しても構いません。`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
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
