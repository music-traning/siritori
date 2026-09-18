import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

export const config = {
  runtime: 'edge', // Edge Runtime
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  
  try {
    const { roomId, playerId, currentTurnIndex } = await req.json();
    if (!roomId || !playerId) return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400 });

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

    const p = players?.find(x => x.id === playerId);
    if (!p) return new Response(JSON.stringify({ error: 'Player not found' }), { status: 404 });

    const newHp = Math.max(0, p.hp - 1);
    await supabase.from('players').update({ hp: newHp }).eq('id', playerId);
    
    const alivePlayers = players.map(x => x.id === playerId ? { ...x, hp: newHp } : x).filter(x => x.hp > 0);
    
    if (newHp <= 0) {
      if (alivePlayers.length === 0) {
        await supabase.from('rooms').update({ status: 'gameover' }).eq('id', roomId);
        await supabase.from('words').insert([{
          room_id: roomId, player_id: playerId, detected_word: '全滅', reading: 'ぜんめつ', next_char: 'ん', comment: 'パスによる自爆で全滅しました💀', image_base64: null
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
      }
    } else {
      await supabase.from('rooms').update({
        current_turn_index: getNextTurnIndex(currentTurnIndex)
      }).eq('id', roomId);
    }

    return new Response(JSON.stringify({ success: true, hp: newHp }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: 'Pass failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
