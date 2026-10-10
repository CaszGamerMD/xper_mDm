/** Light-weight, deterministic prompt interpretation; no AI service or hidden uploads. */
import { THEMES } from './seeds.mjs';

const CREATURES = ['Frog','Goblin','Elf','Dragon','Zombie','Vampire','Wizard','Merfolk','Sliver','Spirit','Dinosaur','Cat','Dog','Angel','Demon','Human','Knight','Soldier','Pirate','Rogue','Faerie','Squirrel','Rat','Mouse','Rabbit','Bird','Snake','Spider','Insect','Treefolk','Elemental','Hydra','Eldrazi','Dragonborn','Turtle','Fish','Shark','Horror','Ooze','Phyrexian','Samurai','Ninja','Warrior','Cleric','Druid','Shaman','Artificer','Construct','Equipment','Vehicle','Artifact'];
const PLURALS = {Elf:'elves', Merfolk:'merfolk', Fish:'fish', Mouse:'mice', Faerie:'faeries', Wolf:'wolves', Zombie:'zombies', Spider:'spiders', Squirrel:'squirrels', Vampire:'vampires', Rabbit:'rabbits', Shaman:'shamans'};
const ALIASES = {
  'blink':['flicker','enter the battlefield','enters the battlefield','etb','bounce my creatures'],
  'aristocrats':['death triggers','die triggers','sacrifice my creatures','sac outlets'],
  'mill':['milling','mill opponents','deck out'],
  'spellslinger':['spellslinger','spellslinger deck','spellslinger strategy','spell slinger','spellslinging','cast lots of spells','instants and sorceries'],
  'landfall':['play extra lands','lands matter','lands entering'],
  'tokens':['token swarm','go wide','lots of tokens','make creatures'],
  'counters':['proliferate','plus one counters','counter synergies'],
  'reanimator':['reanimate','recursion','revive creatures','bring creatures back'],
  'lifegain':['gain life','lifelink','life gain'],
  'artifacts':['artifact deck','artifact synergy'],
  'enchantments':['enchantress','enchantment deck'],
  'treasure':['treasures','treasure tokens'],
  'discard':['discarding','make opponents discard'],
  'voltron':['suit up','one big creature','equip my commander'],
  'infect':['poison counters','toxic'],
  'storm':['storm off','copy spells'],
  '+1/+1 counters':['+1/+1','plus one plus one']
};
function contains(text, phrase) {
  const escaped=phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`,'i').test(text);
}
export function interpretPrompt(prompt) {
  const text=String(prompt||'').toLowerCase().slice(0,1200);
  if (!text.trim()) return {creature_types:[],keywords:[]};
  const creature_types=CREATURES.filter(type=>{
    const word=type.toLowerCase();
    const plural=(PLURALS[type] || word+'s').toLowerCase();
    return contains(text,word) || contains(text,plural);
  }).filter(type=>!['Equipment','Vehicle','Artifact'].includes(type)).slice(0,3);
  const keywords=Object.keys(THEMES).filter(key=>[key,...(ALIASES[key]||[])].some(term=>contains(text,term))).slice(0,5);
  return {creature_types, keywords};
}
