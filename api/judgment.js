import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  try {
    const { imageBase64, lastChar, rule, turnCount, difficulty, roomId, playerId, currentTurnIndex } = req.body;
    if (!imageBase64 || !lastChar) return res.status(400).json({ error: 'Missing imageBase64 or lastChar' });
    if (!roomId || !playerId) return res.status(403).json({ error: 'Forbidden: Missing roomId or playerId' });

    // 部屋の存在とステータス検証 (野良APIリクエスト防止)
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('status, current_turn_index')
      .eq('id', roomId)
      .single();

    if (roomError || !room) {
      return res.status(403).json({ error: 'Forbidden: Room not found' });
    }
    if (room.status !== 'playing' && room.status !== 'waiting') {
      return res.status(403).json({ error: 'Forbidden: Invalid room status' });
    }

    // ターン偽装の防止 (現在アクティブなプレイヤーIDとリクエスト元のIDが一致するか検証)
    const { data: turnPlayers } = await supabase
      .from('players')
      .select('id')
      .eq('room_id', roomId)
      .order('order_index', { ascending: true });

    if (!turnPlayers || turnPlayers.length === 0) {
      return res.status(403).json({ error: 'Forbidden: No players found in room' });
    }

    const currentTurnIndexDB = room.current_turn_index || 0;
    const activePlayerId = turnPlayers[currentTurnIndexDB % turnPlayers.length]?.id;

    if (activePlayerId !== playerId) {
      return res.status(403).json({ error: 'Forbidden: Not your turn (Turn Spoofing detected)' });
    }

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

    systemPrompt += `5. 【不正検知ルール(最優先)】: 画像が「別のスマートフォン、PCモニター、タブレット、テレビなどのデジタル画面を撮影したもの」であると判断できる場合（モアレ現象、ピクセルの網目、画面の反射光、デバイスの枠などが確認できる場合）、被写体が他の条件を全て満たしていても絶対に is_valid: false としてください。その際の comment は必ず「画面を写しちゃダメだよ！実物を探してね🙅‍♀️」としてください。\n`;

    systemPrompt += `\n【難易度に応じた判定方針】\n`;
    if (difficulty === 'easy') {
      systemPrompt += `判定基準を寛容にし、少しでも条件に掠っていれば正解とする。子供と遊ぶように優しく。\n`;
    } else if (difficulty === 'hard') {
      systemPrompt += `条件を極めて厳密に解釈し、少しでも疑わしい場合は容赦無く不正解とする。審査員のように厳しく。\n`;
    } else {
      systemPrompt += `一般的なしりとりの基準で判定すること。\n`;
    }

    systemPrompt += `
【ユーザーへのコメント(comment)のガイドライン】
内部の判定は非常に厳格に行いますが、プレイヤーへ出力する comment は「極めて優しく、ポップでフレンドリーな親友のようなトーン」にしてください。プレイヤーを決して責めないでください。
- 成功例（is_valid: true）: 「お見事！『${lastChar}』から始まる『〇〇』だね✨ 次もがんばって！」
- 失敗例（is_valid: false）: 「あれれ？『${lastChar}』から始まっていないみたい💦 画像には『〇〇』が写っているよ！もう一回探してみてね📸」
- 特別ルール違反時の失敗例: 「『〇〇』いい感じ！…なんだけど、今回の特別ルールには合ってないみたい🥺 別のものを探してみよう！」
`;

    let result;
    try {
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
          },
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE }
          ]
        }
      });
      result = JSON.parse(response.text);
    } catch (error) {
      console.error("AI Safety or Parse Error:", error);
      result = {
        is_valid: false,
        detected_word: '判定不可',
        reading: 'はんていふか',
        next_char: lastChar,
        comment: '不適切な画像、またはAIが判定できない画像です🚨',
        is_inappropriate: true
      };
    }
    
    // 強制検算ロジック: AIのハルシネーション対策
    if (result.reading && result.reading.charAt(0) !== lastChar) {
      result.is_valid = false;
      result.comment = `あれれ？『${lastChar}』から始まっていないみたい💦 もう一度探してみてね！`;
    }

    // ----------------------------------------------------
    // バックエンド側でのゲームロジック進行 (DB書き込み)
    // ----------------------------------------------------
    const { data: players } = await supabase.from('players').select('*').eq('room_id', roomId).order('order_index', { ascending: true });
    
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

    const isNGameOver = result.is_game_over || result.reading?.endsWith('ん') || result.next_char === 'ん';

    if (result.is_inappropriate || (!result.is_valid && !isNGameOver)) {
      // 失敗・不適切な画像: プレイヤーのHPを減算し、勝敗判定
      const p = players?.find(x => x.id === playerId);
      if (p) {
        const newHp = Math.max(0, p.hp - 1);
        await supabase.from('players').update({ hp: newHp }).eq('id', playerId);
        
        const alivePlayers = players.map(x => x.id === playerId ? { ...x, hp: newHp } : x).filter(x => x.hp > 0);
        
        if (newHp <= 0) {
          // HPが0になった場合のみ勝敗チェックを行う
          if (alivePlayers.length === 0) {
            // 全滅
            await supabase.from('rooms').update({ status: 'gameover' }).eq('id', roomId);
            await supabase.from('words').insert([{
              room_id: roomId, player_id: playerId, detected_word: '全滅', reading: 'ぜんめつ', next_char: 'ん', comment: '生存者が0人になりました...全員脱落です💀', image_base64: null
            }]);
          } else if (players.length > 1 && alivePlayers.length === 1) {
            // 1人だけ生存 (サバイバル勝利)
            await supabase.from('rooms').update({ status: 'clear' }).eq('id', roomId);
            const winner = alivePlayers[0];
            await supabase.from('words').insert([{
              room_id: roomId, player_id: winner.id, detected_word: '優勝', reading: 'ゆうしょう', next_char: 'ん', comment: `${winner.name} さんの完全勝利です！🎉`, image_base64: null
            }]);
          } else {
            // 他に2人以上生存者がいる場合はターンを次に回す
            await supabase.from('rooms').update({
              current_turn_index: getNextTurnIndex(currentTurnIndex)
            }).eq('id', roomId);
          }
        }
        // HPが1以上の場合は、ターンは進めず何もしない（もう一度同じ人のターン）
      }
    } else if (isNGameOver) {
      // 「ん」で終わる自爆
      const p = players?.find(x => x.id === playerId);
      if (p) {
        await supabase.from('players').update({ hp: 0 }).eq('id', playerId);
        const alivePlayers = players.map(x => x.id === playerId ? { ...x, hp: 0 } : x).filter(x => x.hp > 0);
        
        if (alivePlayers.length === 0) {
          await supabase.from('rooms').update({ status: 'gameover' }).eq('id', roomId);
          await supabase.from('words').insert([{
            room_id: roomId, player_id: playerId, detected_word: '全滅', reading: 'ぜんめつ', next_char: 'ん', comment: '「ん」がついて全滅しました💀', image_base64: null
          }]);
        } else if (players.length > 1 && alivePlayers.length === 1) {
          await supabase.from('rooms').update({ status: 'clear' }).eq('id', roomId);
          const winner = alivePlayers[0];
          await supabase.from('words').insert([{
            room_id: roomId, player_id: winner.id, detected_word: '優勝', reading: 'ゆうしょう', next_char: 'ん', comment: `${winner.name} さんの完全勝利です！🎉`, image_base64: null
          }]);
        } else {
          await supabase.from('rooms').update({
            current_turn_index: getNextTurnIndex(currentTurnIndex)
          }).eq('id', roomId);
          await supabase.from('words').insert([{
            room_id: roomId, player_id: playerId, detected_word: result.detected_word, reading: result.reading, next_char: result.next_char, comment: result.comment, image_base64: null
          }]);
        }
      }
    } else if (result.is_valid) {
      // 正解: 単語を挿入し、ターンを進める
      await supabase.from('words').insert([{
        room_id: roomId, player_id: playerId, detected_word: result.detected_word, reading: result.reading, next_char: result.next_char, comment: result.comment, image_base64: null
      }]);
      await supabase.from('rooms').update({
        current_turn_index: getNextTurnIndex(currentTurnIndex),
        current_char: result.next_char
      }).eq('id', roomId);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Judgment failed' });
  }
}
