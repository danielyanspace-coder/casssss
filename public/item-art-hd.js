/**
 * Реестр объёмных рисунков: у каждого предмета свой.
 *
 * Рисунок ищется по ключу, который сервер кладёт в предмет полем `art`
 * (server/cases.js): «тема/номер» для обычных предметов, «perk/...» для
 * плюшек, «jackpot/<кейс>» для джекпотов. Не по названию: одиннадцать названий
 * повторяются в разных темах («Щит с гербом» есть и в крепости, и в
 * Вестеросе), и по названию два разных предмета получили бы один рисунок.
 *
 * Кисть и свет - в hd/kit.js, общие детали - в hd/parts.js, рисунки - в
 * hd/<тема>.js, плюшки - в hd/special.js. Новая тема в server/themes.js без
 * своего файла здесь роняет test/art.mjs, а не показывает пустые карточки.
 */
import { hdKit } from './hd/kit.js';
import { hdSpecial } from './hd/special.js';
import { HD_ARCTIC } from './hd/arctic.js';
import { HD_ATOM } from './hd/atom.js';
import { HD_BRAAVOS } from './hd/braavos.js';
import { HD_CASINO } from './hd/casino.js';
import { HD_CIRCUS } from './hd/circus.js';
import { HD_CRYSTAL } from './hd/crystal.js';
import { HD_CYBER } from './hd/cyber.js';
import { HD_DEEPSEA } from './hd/deepsea.js';
import { HD_DESERT } from './hd/desert.js';
import { HD_DRAGON } from './hd/dragon.js';
import { HD_DUBAI } from './hd/dubai.js';
import { HD_FORGE } from './hd/forge.js';
import { HD_FORTRESS } from './hd/fortress.js';
import { HD_GALAXY } from './hd/galaxy.js';
import { HD_GARAGE } from './hd/garage.js';
import { HD_GOLDMINE } from './hd/goldmine.js';
import { HD_HIGHGARDEN } from './hd/highgarden.js';
import { HD_MONACO } from './hd/monaco.js';
import { HD_NEON } from './hd/neon.js';
import { HD_NOIR } from './hd/noir.js';
import { HD_ORBIT } from './hd/orbit.js';
import { HD_PHARAOH } from './hd/pharaoh.js';
import { HD_PHOENIX } from './hd/phoenix.js';
import { HD_PIRATE } from './hd/pirate.js';
import { HD_RACING } from './hd/racing.js';
import { HD_RIO } from './hd/rio.js';
import { HD_ROYAL } from './hd/royal.js';
import { HD_RUNE } from './hd/rune.js';
import { HD_SAMURAI } from './hd/samurai.js';
import { HD_SANTORINI } from './hd/santorini.js';
import { HD_SHADOW } from './hd/shadow.js';
import { HD_SINGAPORE } from './hd/singapore.js';
import { HD_STEAMPUNK } from './hd/steampunk.js';
import { HD_STREET } from './hd/street.js';
import { HD_TOXIC } from './hd/toxic.js';
import { HD_VAMPIRE } from './hd/vampire.js';
import { HD_VAULT } from './hd/vault.js';
import { HD_VEGAS } from './hd/vegas.js';
import { HD_VOLCANO } from './hd/volcano.js';
import { HD_WESTEROS } from './hd/westeros.js';
import { HD_WINTERFELL } from './hd/winterfell.js';

export const HD_THEMES = {
  arctic: HD_ARCTIC,
  atom: HD_ATOM,
  braavos: HD_BRAAVOS,
  casino: HD_CASINO,
  circus: HD_CIRCUS,
  crystal: HD_CRYSTAL,
  cyber: HD_CYBER,
  deepsea: HD_DEEPSEA,
  desert: HD_DESERT,
  dragon: HD_DRAGON,
  dubai: HD_DUBAI,
  forge: HD_FORGE,
  fortress: HD_FORTRESS,
  galaxy: HD_GALAXY,
  garage: HD_GARAGE,
  goldmine: HD_GOLDMINE,
  highgarden: HD_HIGHGARDEN,
  monaco: HD_MONACO,
  neon: HD_NEON,
  noir: HD_NOIR,
  orbit: HD_ORBIT,
  pharaoh: HD_PHARAOH,
  phoenix: HD_PHOENIX,
  pirate: HD_PIRATE,
  racing: HD_RACING,
  rio: HD_RIO,
  royal: HD_ROYAL,
  rune: HD_RUNE,
  samurai: HD_SAMURAI,
  santorini: HD_SANTORINI,
  shadow: HD_SHADOW,
  singapore: HD_SINGAPORE,
  steampunk: HD_STEAMPUNK,
  street: HD_STREET,
  toxic: HD_TOXIC,
  vampire: HD_VAMPIRE,
  vault: HD_VAULT,
  vegas: HD_VEGAS,
  volcano: HD_VOLCANO,
  westeros: HD_WESTEROS,
  winterfell: HD_WINTERFELL,
};

/** Функция рисования по ключу; null, если ключа нет. */
export function hdDrawFor(key) {
  if (!key) return null;
  const [theme, idx] = String(key).split('/');
  if (theme === 'perk' || theme === 'jackpot') return hdSpecial(key);
  return HD_THEMES[theme]?.[Number(idx)] || null;
}

/** Готовая svg по ключу; null - вызывающий откатится на старые наборы мотивов. */
export function itemArtHd(key) {
  const draw = hdDrawFor(key);
  if (!draw) return null;
  const k = hdKit();
  return k.svg(draw(k));
}
