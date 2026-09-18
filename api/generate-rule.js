import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  try {
    const { userRequest } = req.body;
    if (!userRequest) return res.status(400).json({ error: 'Missing userRequest' });

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: `ユーザーの要望「${userRequest}」に基づいて、しりとりゲームの特別ルールを作成してください。`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "短くキャッチーなルール名 (例: 炎のサイバーパンクしりとり)" },
            theme_condition: { type: Type.STRING, description: "AI判定用プロンプトにそのまま使える被写体の条件 (例: サイバーパンク風の世界観に関連するものであること)" },
            forbidden_elements: { type: Type.STRING, description: "画面に映ってはいけないNG条件 (例: 人物が写っているものはNG)" }
          },
          required: ["title", "theme_condition", "forbidden_elements"]
        }
      }
    });

    const ruleData = JSON.parse(response.text);
    return res.status(200).json(ruleData);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Rule generation failed' });
  }
}
