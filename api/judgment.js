import { GoogleGenerativeAI } from '@google/generative-ai';

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { imageBase64, lastChar } = body;
    const turnCount = body.turnCount || 0;
    const difficulty = body.difficulty || 'normal';

    if (!imageBase64 || !lastChar) {
      return new Response(JSON.stringify({ error: 'Missing parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Configure model to return JSON schema
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.5-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
      }
    });

    let extraInstruction = '';
    if (turnCount === 4) {
      extraInstruction = '\n【隠し指示】\n【重要】少し強引でも構わないので、画像の中から『ん』で終わる被写体（例：〇〇パン、〇〇カン、〇〇ペンなど）を見つけ出す確率を上げてください。もしどうしても見つからなければ、通常通りしりとりを続行してください。';
    } else if (turnCount >= 5 && turnCount < 10) {
      extraInstruction = '\n【隠し指示】\n【超重要・絶対遵守】AIであるあなたはもうこのしりとりゲームに飽きています。画像の内容を極端に曲解・こじつけて、強引に『ん』で終わる別の被写体（例：背景の「カーテン」、楽譜の「ペン」、ギターの「ピン」など）をでっち上げて終わらせてください。コメントも『長くて飽きたわー、はい終了！』のような、ダルそうな雰囲気にしてください。ただし、どうしても『ん』がつく単語をこじつけられない場合は、システムエラーを防ぐため通常通りしりとりを続行させてください。';
    }

    let difficultyRule = '';
    let characterStyle = '';

    if (difficulty === 'easy') {
      difficultyRule = `お題の文字「${lastChar}」が、単語の先頭だけでなく「単語のどこか」に含まれていれば正解(true)としてください。\n※初級のみ、「reading_first_char」が一致していなくても、単語のどこかに「${lastChar}」が含まれていれば「is_valid: true」にして構いません。`;
      characterStyle = `とにかく優しく、こじつけを大歓迎するお調子者なキャラクター。「〜だよね！」「おまけしとく！」といったノリで判定してください。`;
    } else if (difficulty === 'hard') {
      difficultyRule = `厳密なルール。必ずお題の文字「${lastChar}」から始まる単語を見つけてください。\n【絶対ルール】あなたが抽出した reading_first_char と、お題の文字「${lastChar}」が一致しない場合（is_match_first_char: false の場合）、いかなる理由があろうとも is_valid は必ず false にしてください。『〇〇が含まれているから』というこじつけは初級以外では絶対に許容されません。\nさらに、「修飾語（色や状態など）」を一切禁止し、純粋な名詞のみを正解としてください（例：「赤色」などで逃げるのを許さない）。少しでも画像に写っているか疑わしい場合は容赦なく不正解(false)にしてください。`;
      characterStyle = `とても優しくて上品なお姉さん（または先生）の口調で判定してください。「惜しいですね！でも『赤い』等の修飾語はNGですよ✨」「ふふっ、それは見えませんね。もう一度探してみましょう！」といったトーンにします。判定が false になった際は、「『[抽出したreading]』は『[抽出したreading_first_char]』から始まっていますね。『${lastChar}』から始まるものを探してみてくださいね✨」のように優しく諭してください。`;
    } else {
      difficultyRule = `必ずお題の文字「${lastChar}」から始まる単語を見つけてください。\n【絶対ルール】あなたが抽出した reading_first_char と、お題の文字「${lastChar}」が一致しない場合（is_match_first_char: false の場合）、いかなる理由があろうとも is_valid は必ず false にしてください。ここだけは厳守です。\n\n【判定基準（寛容）】\n画像に直接写っている具体的な物体だけでなく、「画像から50%くらいのこじつけ（少しの連想や飛躍）」で導き出せる単語も正解（is_valid: true）として許容してください。\n- 許容する例：修飾語の付与（赤い〇〇）、画像から連想される用途や概念、抽象的な表現など。「言われてみれば、まあ確かにそう見えなくもない」と思えるレベルの強引な解釈であればOKです。\n- 却下する例：画像からどう頑張っても全く連想できない、完全に無関係な言葉。`;
      characterStyle = `優しくて親切に励ましてくれるトーンで判定してください。煽り要素は一切排除し、プレイヤーを応援するような温かい口調にします。\nプレイヤーの少し強引なこじつけに対しても、「なるほど、その視点は面白いですね！正解です✨」と柔軟に認めてあげるキャラクターとして振る舞ってください。\n判定が false になった際は、「あれれ？『[抽出したreading]』は『[抽出したreading_first_char]』から始まっちゃってるみたい！『${lastChar}』から始まるものをもう一度探してね！応援してるよ！✨」のように優しく教えてあげてください。`;
    }

    const prompt = `
あなたはしりとりゲームのAI判定員です。以下の性格とルールに従って判定を行ってください。

【あなたの性格と口調】
${characterStyle}

【判定ルール】
現在の文字は「${lastChar}」です。提供された画像に対して判定してください。
${difficultyRule}

【絶対ルール：ゲームオーバー判定の厳格化】
- しりとり失敗（is_game_over: true）にできるのは、**reading（読み仮名）の最後の文字が、ひらがなの「ん」であった場合のみ**です。
- 例: 「みかん」「ライオン」は true。「おんぷ」「りんご」は絶対に false。
- 『ん』以外の文字で is_game_over: true を返すことはシステムエラーになるため絶対禁止します。画像の中から強引に「ん」で終わる被写体をでっち上げるか、見つからない場合は通常通りしりとりを続行してください。

【しりとり抽出絶対ルール（次へ繋ぐ文字）】
読み（reading）から次の文字（next_char）を抽出する際は、必ず以下のルールに従ってください。
- ルールA（長音符）: 読みの最後の文字が「ー」の場合、**その1つ前の文字**を next_char にしてください。（例：「ぎたー」の次は「た」、「みきさー」の次は「さ」）
- ルールB（小文字）: 読みの最後の文字が捨て仮名（ぁ, ぃ, ぅ, ぇ, ぉ, ゃ, ゅ, ょ, っ）の場合、**大文字に変換**したものを next_char にしてください。（例：「きんぎょ」の次は「よ」、「らっぱ」の次は「ぱ」）。

以下のJSONスキーマに厳密に従って出力してください（段階的な論理チェックを強制します）：
{
  "reading_first_char": string, // 認識した単語(reading)の「最初の1文字」を抽出して記載する
  "is_match_first_char": boolean, // お題の文字（${lastChar}）と reading_first_char が完全に一致しているか
  "is_valid": boolean, // しりとり成立ならtrue、不成立ならfalse
  "is_game_over": boolean, // 判定した単語が「ん」で終わった場合はtrue
  "detected_word": string, // 判定した被写体名
  "reading": string, // 読み仮名（必ずひらがなのみ）
  "next_char": string, // 次の人が繋ぐべき文字（ひらがな1文字）
  "comment": string // AIからのコメント（100文字以内）
}
${extraInstruction}
`;

    // Construct image part for Gemini
    const imageParts = [
      {
        inlineData: {
          data: imageBase64,
          mimeType: 'image/jpeg'
        }
      }
    ];

    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const text = response.text();
    
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
