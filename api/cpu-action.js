import { GoogleGenAI, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

export const config = {
  runtime: 'edge', // Edge Runtimeを明示
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  
  try {
    const { roomId, playerId, currentTurnIndex, lastChar, difficulty, usedWords, rule } = await req.json();
    
    if (!roomId) {
      return new Response(JSON.stringify({ error: 'Forbidden: Missing roomId' }), { status: 403 });
    }
    if (!lastChar) {
      return new Response(JSON.stringify({ error: 'Missing lastChar' }), { status: 400 });
    }
    if (!playerId) {
      return new Response(JSON.stringify({ error: 'Forbidden: Missing playerId' }), { status: 403 });
    }

    // 部屋の存在とステータス、およびターン検証
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('status, current_turn_index')
      .eq('id', roomId)
      .single();
    if (roomError || !room || (room.status !== 'playing' && room.status !== 'waiting')) {
      return new Response(JSON.stringify({ error: 'Forbidden: Invalid room or status' }), { status: 403 });
    }

    const { data: players, error: playersError } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .order('order_index', { ascending: true });
    if (playersError || !players || players.length === 0) {
      return new Response(JSON.stringify({ error: 'Forbidden: Players not found' }), { status: 403 });
    }

    // 割り算の余り（modulo）を使って現在の正当なプレイヤーを特定
    const activePlayer = players[room.current_turn_index % players.length];
    if (activePlayer.id !== playerId) {
      return new Response(JSON.stringify({ error: 'Forbidden: Not your turn' }), { status: 403 });
    }

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
    
    prompt += `\n【難易度に応じた単語選び】\n`;
    if (difficulty === 'easy') {
      prompt += `子供でも知っている簡単な単語を選ぶこと。\n`;
    } else if (difficulty === 'hard') {
      prompt += `大人でも思いつきにくい、少しマニアックで長い単語を選ぶこと。AIの語彙力を見せつけること。\n`;
    } else {
      prompt += `一般的なしりとりで使われる普通の単語を選ぶこと。\n`;
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

    let result = JSON.parse(response.text);
    
    // 強制検算ロジック: AIのハルシネーション対策
    if (result.reading && result.reading.charAt(0) !== lastChar) {
      result.detected_word = 'システムエラーん';
      result.reading = 'しすてむえらーん';
      result.next_char = 'ん';
      result.comment = `う〜ん、『${lastChar}』から始まる言葉がどうしても思いつかないや…降参するね🤖💦`;
    }

    // バックエンド側でのゲームロジック進行 (DB書き込み)
    
    const getNextTurnIndex = (currentIndex) => {
      if (!players) return currentIndex + 1;
      const numPlayers = players.length;
      if (numPlayers === 0) return currentIndex + 1;
      let nextIndex = currentIndex + 1;
      for(let i=0; i<numPlayers; i++) {
        const p = players[nextIndex % numPlayers];
        if (p && p.hp > 0) return nextIndex;
        nextIndex++;
      }
      return nextIndex;
    };

    const isNGameOver = result.next_char === 'ん' || result.reading?.endsWith('ん');

    if (isNGameOver) {
      // 「ん」で終わる自爆
      const p = players?.find(x => x.id === playerId);
      if (p) {
        await supabase.from('players').update({ hp: 0 }).eq('id', playerId);
        const alivePlayers = players.map(x => x.id === playerId ? { ...x, hp: 0 } : x).filter(x => x.hp > 0);
        
        const wordsToInsert = [{
          room_id: roomId, player_id: playerId,
          detected_word: result.detected_word, reading: result.reading,
          next_char: result.next_char, comment: result.comment, image_base64: null
        }];

        if (alivePlayers.length === 0) {
          wordsToInsert.push({
            room_id: roomId, player_id: playerId, detected_word: '全滅', reading: 'ぜんめつ', next_char: 'ん', comment: '「ん」がついて全滅しました💀', image_base64: null
          });
          await supabase.from('rooms').update({ status: 'gameover' }).eq('id', roomId);
        } else if (players.length > 1 && alivePlayers.length === 1) {
          const winner = alivePlayers[0];
          wordsToInsert.push({
            room_id: roomId, player_id: winner.id, detected_word: '優勝', reading: 'ゆうしょう', next_char: 'ん', comment: `${winner.name} さんの完全勝利です！🎉`, image_base64: null
          });
          await supabase.from('rooms').update({ status: 'clear' }).eq('id', roomId);
        } else {
          await supabase.from('rooms').update({
            current_turn_index: getNextTurnIndex(currentTurnIndex)
          }).eq('id', roomId);
        }
        await supabase.from('words').insert(wordsToInsert);
      }
    } else {
      await supabase.from('words').insert([{
        room_id: roomId,
        player_id: playerId,
        detected_word: result.detected_word,
        reading: result.reading,
        next_char: result.next_char,
        comment: result.comment,
        image_base64: null
      }]);
      await supabase.from('rooms').update({
        current_turn_index: getNextTurnIndex(currentTurnIndex),
        current_char: result.next_char
      }).eq('id', roomId);
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: 'CPU action failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
