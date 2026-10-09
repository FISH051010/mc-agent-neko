/**
 * The only absolute-HP reflexes that remain: consume healing resources already
 * carried by the bot. These helpers are pure so the retirement boundary can be
 * regression-tested without a live Minecraft client.
 */
import { FOOD_FLOOR, cannotRegen } from './food_floor.js';   // ★T-0188 "回不了血" 判据与 FOOD_FLOOR/eatFloor 同源

// ★T-0155: 生鸡肉 (30% 饥饿 debuff, 饿到掉血时反而更快掉) 两档都排除 — 旧正则 /chicken/ 把生鸡肉当正常食物。
const NORMAL_FOOD_RE = /cooked_|_bread|^bread$|apple|carrot|potato|^beef$|^porkchop$|^mutton$|cod|salmon|melon_slice|sweet_berries|_stew|rabbit|baked_/;
const EMERGENCY_FOOD_RE = /^rotten_flesh$|^beef$|^porkchop$|^mutton$|^rabbit$|^cod$|^salmon$/;
const RAW_RE = /^(beef|porkchop|mutton|rabbit|cod|salmon)$/;
/** auto_eat 挑背包食物: 正常食物 (熟食先于生肉); 都没有且 food≤6 或 (hp≤12 且 food<18) → 应急档 (腐肉/生肉)。绝不挑生鸡肉。 */
export function pickAutoEatFood(items, { health = 20, food = 20 } = {}) {
    const list = (items || []).filter(i => i && i.name && i.name !== 'chicken');
    let pick = list.find(i => NORMAL_FOOD_RE.test(i.name) && !RAW_RE.test(i.name))
        || list.find(i => NORMAL_FOOD_RE.test(i.name));
    if (!pick && (food <= FOOD_FLOOR || cannotRegen(health, food))) pick = list.find(i => EMERGENCY_FOOD_RE.test(i.name));
    return pick || null;
}

export function shouldAutoEat({ health = 20, food = 20, foodInstincts = false } = {}) {
    if (!Number.isFinite(health) || health <= 0 || !Number.isFinite(food)) return false;
    if (health < 20 && food < 18) return true; // unblock vanilla regeneration
    return !!foodInstincts && food <= 17;
}

function potionText(item) {
    try {
        return JSON.stringify({
            name: item && item.name,
            displayName: item && item.displayName,
            nbt: item && item.nbt,
            components: item && item.components,
            componentMap: item && item.componentMap,
        }).toLowerCase();
    } catch (e) {
        return '';
    }
}

/** Return instant_health/regeneration for a drinkable healing potion, else null. */
export function healingPotionEffect(item) {
    if (!item || item.name !== 'potion') return null;
    const text = potionText(item);
    // Reject harmful/custom variants before accepting broad effect names.
    if (/harming|instant_damage|poison|wither/.test(text)) return null;
    if (/healing|instant_health/.test(text)) return 'instant_health';
    if (/regeneration/.test(text)) return 'regeneration';
    return null;
}

export function chooseHealingPotion(items = []) {
    const candidates = items
        .map(item => ({ item, effect: healingPotionEffect(item) }))
        .filter(x => x.effect);
    return (candidates.find(x => x.effect === 'instant_health') || candidates[0] || {}).item || null;
}
