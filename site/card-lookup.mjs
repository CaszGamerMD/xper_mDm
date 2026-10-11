/** Exact card-name resolution for Scryfall's two-faced/split/adventure layouts.
 * Decklist exports often use "Front // Back", while Scryfall bulk lookups
 * can return the combined Oracle card for the front-face identifier.
 * Never accept a fuzzy response whose actual name/face does not match.
 */
export function cardNameKey(name) {
  return String(name || '').trim().replace(/\s*\/\/\s*/g,' // ')
    .replace(/\s+/g,' ').toLocaleLowerCase();
}
export function cardFaceNames(name) {
  return String(name || '').split(/\s*\/\/\s*/).map(s=>s.trim()).filter(Boolean);
}
export function matchesCardName(writtenName,card) {
  const requested=cardNameKey(writtenName);
  if(!requested||!card?.name)return false;
  const full=cardNameKey(card.name);
  if(requested===full)return true;
  // A full-name submission must match BOTH faces. Do not silently turn
  // "Front // Wrong Back" into "Front // Correct Back".
  if(requested.includes(' // '))return false;
  return cardFaceNames(card.name).some(face=>cardNameKey(face)===requested);
}
function addResolved(byRequest,pending,cards) {
  for(const name of pending) {
    if(byRequest.has(cardNameKey(name)))continue;
    const exact=cards.find(card=>cardNameKey(card.name)===cardNameKey(name));
    const alias=exact||cards.find(card=>matchesCardName(name,card));
    if(alias)byRequest.set(cardNameKey(name),alias);
  }
}
export async function resolveCardNames(names,source) {
  const unique=[...new Map(names.map(name=>[cardNameKey(name),String(name).trim()])).values()];
  const byRequest=new Map();
  if(!unique.length)return byRequest;
  // The original names can be sent in bulk; any normalized/full names that
  // Scryfall returns are matched against the user's requests afterwards.
  addResolved(byRequest,unique,await source.collection(unique));
  let pending=unique.filter(name=>!byRequest.has(cardNameKey(name)));
  // Face 1 is the card's identifier in many deck exporters and Scryfall paths.
  const faceQueries=[...new Set(pending.filter(n=>n.includes('//')).map(n=>cardFaceNames(n)[0]))];
  if(faceQueries.length) {
    addResolved(byRequest,pending,await source.collection(faceQueries));
    pending=unique.filter(name=>!byRequest.has(cardNameKey(name)));
  }
  // A small number of hard-to-find names may require Scryfall's named route.
  // Never accidentally accept a nearby fuzzy result for a different card.
  for(const name of pending.slice(0,12)) {
    const query=name.includes('//')?cardFaceNames(name)[0]:name;
    const card=await source.named(query);
    if(matchesCardName(name,card))byRequest.set(cardNameKey(name),card);
  }
  return byRequest;
}

/** Named lookup for commander/favorite entries, including a fully written back face. */
export async function lookupNamedCard(name,source) {
  const written=String(name||'').trim();
  const direct=await source.named(written);
  if(!written.includes('//'))return direct;
  if(matchesCardName(written,direct))return direct;
  const front=cardFaceNames(written)[0];
  const alternate=await source.named(front);
  return matchesCardName(written,alternate)?alternate:null;
}
