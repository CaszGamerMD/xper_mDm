/** Pure helpers for browsing cards independently of the generation engine. */
export const CARD_TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Land', 'Other'];

/** One bucket per card, even for mixed types such as Artifact Creatures. */
export function primaryType(card) {
  const type = String(card.type || card.type_line || '').split(' // ')[0].split(' — ')[0];
  if (/\bLand\b/i.test(type)) return 'Land';
  return CARD_TYPES.find(name => name !== 'Other' && new RegExp(`\\b${name}\\b`, 'i').test(type)) || 'Other';
}

export function sortedCardGroups(deck, order = 'type-cmc') {
  const cards = (deck.groups || []).flatMap(group => group.cards || []);
  const byType = new Map(CARD_TYPES.map(type => [type, []]));
  for (const card of cards) byType.get(primaryType(card)).push(card);
  const compareMana = (a, b) => Number(a.cmc || 0) - Number(b.cmc || 0) || a.name.localeCompare(b.name);
  if (order === 'cmc-type') {
    const ordered = [...cards].sort((a,b) => Number(a.cmc||0)-Number(b.cmc||0) || CARD_TYPES.indexOf(primaryType(a))-CARD_TYPES.indexOf(primaryType(b)) || a.name.localeCompare(b.name));
    return [{name:'All card types · mana value',cards:ordered}];
  }
  return CARD_TYPES.filter(type=>byType.get(type).length).map(type => ({
    name:type, cards:byType.get(type).sort(compareMana)
  }));
}

/** Excludes the commander and every land, even nonbasics / modal lands. */
export function averageSpellManaValue(cards) {
  const spells = cards.filter(card => !card.land && !/\bLand\b/.test(String(card.type || card.type_line || '').split(' // ')[0]));
  return spells.length ? spells.reduce((sum,c)=>sum+Number(c.cmc||0),0)/spells.length : 0;
}
