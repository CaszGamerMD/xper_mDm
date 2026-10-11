/** Shared pregame mulligan operations for both live practice modes.
 * Friendly: any number of reshuffles, always keep seven, no bottoming.
 * Strict: exactly X - 1 bottomed cards after keeping, where X is the number
 * of mulligans. This implements the requested first-free-mulligan convention
 * in a 1v1 practice environment (not an exhaustive sanctioned event model).
 */
import {DeckInputError} from './generator.mjs';
export function normalizeMulliganMode(mode){
  if(mode!=='friendly' && mode!=='strict')throw new DeckInputError('Mulligan mode must be Friendly or Strict.');
  return mode;
}
export function bottomRequired(mode,mulligans){
  normalizeMulliganMode(mode);
  if(!Number.isInteger(mulligans)||mulligans<0)throw new DeckInputError('Invalid mulligan count.');
  return mode==='friendly'?0:Math.max(0,mulligans-1);
}
export function bottomSelected(hand,library,selected,count){
  if(!Array.isArray(hand)||!Array.isArray(library)||!Array.isArray(selected))
    throw new DeckInputError('Invalid mulligan state.');
  if(selected.length!==count || new Set(selected).size!==selected.length ||
    selected.some(i=>!Number.isInteger(i)||i<0||i>=hand.length))
    throw new DeckInputError('Select exactly '+count+' distinct cards to place on the bottom.');
  const indices=new Set(selected);
  const bottomed=hand.filter((_,i)=>indices.has(i));
  const keep=hand.filter((_,i)=>!indices.has(i));
  hand.splice(0,hand.length,...keep);
  library.push(...bottomed);
  return bottomed;
}
const isLand=card=>/\bLand\b/.test(String(card.type||card.type_line||'').split(' — ')[0]);
export function chooseBotBottom(hand,count){
  if(count<=0)return [];
  if(count>hand.length)throw new DeckInputError('Too many cards to bottom.');
  const selected=[],landIndices=hand.map((card,i)=>isLand(card)?i:null).filter(i=>i!==null);
  const spellIndices=hand.map((card,i)=>!isLand(card)?i:null).filter(i=>i!==null);
  // Try to retain 2-4 lands in a 7-card opener where hand size permits.
  const wantLands=Math.max(0,Math.min(3,hand.length-count-1));
  const surplus=Math.max(0,landIndices.length-wantLands);
  for(const i of landIndices.slice().reverse().slice(0,Math.min(count,surplus)))selected.push(i);
  const candidates=spellIndices
    .slice().sort((a,b)=>(Number(hand[b].cmc)||0)-(Number(hand[a].cmc)||0));
  for(const i of candidates)if(selected.length<count)selected.push(i);
  for(let i=hand.length-1;i>=0&&selected.length<count;i--)
    if(!selected.includes(i))selected.push(i);
  return selected.sort((a,b)=>a-b);
}
