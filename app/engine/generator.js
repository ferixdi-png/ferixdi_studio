// @ts-check
/**
 * FERIXDI Studio — Generator v2
 * Production Contract: Veo 3.1 • 8s • Handheld Selfie Feel
 * Universal character adapter — работает с любой парой из каталога
 */

import { estimateDialogue } from './estimator.js';
import { runAllValidations, scanBannedWords } from './validators.js';
import { autoTrim } from './auto_trim.js';
import { historyCache } from './history_cache.js';

// ─── V2 TIMING GRID ─────────────────────────
const GRID_V2 = {
  hook:    { start: 0.0, end: 0.7 },
  act_A:   { start: 0.7, end: 3.5 },
  act_B:   { start: 3.5, end: 7.0 },
  release: { start: 7.0, end: 8.0 },
};

// ─── LOCATIONS (fallback — used when no external locations loaded) ──
const FALLBACK_LOCATIONS = [
  'Weathered wooden barn interior, hay bales, single dusty lightbulb swinging, cracks of sunlight through planks',
  'Old bathhouse interior, fogged mirrors, wooden benches, copper ladle, steam wisps in backlight',
  'Root cellar with earthen walls, shelves of preserves in glass jars, bare bulb overhead, cool blue-tint air',
  'Soviet-era kitchen, peeling wallpaper, humming Saratov fridge, net curtains filtering amber sunlight',
  'Concrete balcony with drying laundry, distant city haze, rusted railing with chipped turquoise paint',
  'Stairwell landing with beige tile, fluorescent tube buzzing overhead, mailboxes, elevator door ajar',
  'Open-air bazaar stall, pyramid of watermelons, striped awning, plastic bags rustling in breeze',
  'Park bench near pond with pigeons, birch trees, distant accordion music, golden hour light',
];

// ─── HOOK ACTIONS v2 ─────────────────────────
const HOOK_ACTIONS = [
  { action_en: 'sharp finger jab at lens, near-miss touch, finger trembling with rage', action_ru: 'Палец в камеру, почти касаясь линзы, палец дрожит от злости', audio: 'mechanical trigger + sharp inhale' },
  { action_en: 'knuckle rap on invisible screen, leaning forward with intensity', action_ru: 'Стук костяшками по «стеклу», наклон вперёд', audio: 'knocking + surprised gasp' },
  { action_en: 'abrupt lean-in to camera, face filling 80% of frame, eyes wide', action_ru: 'Резкий наклон к камере, лицо заполняет кадр, глаза широко', audio: 'cloth rustle + tense exhale' },
  { action_en: 'slap on table surface, objects rattle and jump, hand stays flat', action_ru: 'Удар ладонью по столу, предметы подпрыгивают', audio: 'table slap + glass rattle + sharp exhale' },
  { action_en: 'dramatic removal of glasses with one hand, stare directly into lens', action_ru: 'Драматичное снятие очков одной рукой, взгляд прямо в камеру', audio: 'fabric whoosh + stare-down silence' },
  { action_en: 'phone thrust at camera showing screen, arm fully extended, screen glowing', action_ru: 'Тычет телефоном в камеру, рука вытянута, экран светится', audio: 'phone buzz + sharp gasp' },
  { action_en: 'both hands slam on table simultaneously, body jolts forward', action_ru: 'Обе ладони по столу одновременно, тело дёргается вперёд', audio: 'double impact + dishes rattle + sharp inhale' },
  { action_en: 'grabs other person by sleeve, pulls them toward camera', action_ru: 'Хватает другого за рукав, тянет к камере', audio: 'fabric grab + startled yelp' },
  { action_en: 'throws hands up in disbelief, mouth drops open, eyes bulging', action_ru: 'Вскидывает руки в шоке, рот открыт, глаза выпучены', audio: 'whoosh of arms + exasperated gasp' },
  { action_en: 'leans back, crosses arms, slow deliberate head shake with narrowed eyes', action_ru: 'Откидывается назад, скрещивает руки, медленно качает головой', audio: 'chair creak + slow nose exhale + fabric shift' },
];

// ─── RELEASE ACTIONS v2 ──────────────────────
const RELEASE_ACTIONS = [
  { action_en: 'shared raspy wheeze-laugh, camera shakes from body tremor', action_ru: 'Общий хриплый смех, камера трясётся от тряски тела', audio: 'overlapping wheeze-laughs, gasping inhales, camera mic rumble from hand shake' },
  { action_en: 'A slaps own knee, B doubles over, tears forming', action_ru: 'A хлопает по колену, B сгибается пополам, слёзы', audio: 'knee slap impact, strained laughing exhale, sniffling tears' },
  { action_en: 'both lean into each other laughing, brief embrace', action_ru: 'Оба заваливаются друг на друга от смеха', audio: 'fabric collision rustle, dual belly-laugh, affectionate shoulder pat' },
  { action_en: 'A covers mouth suppressing laugh, B slow triumphant grin', action_ru: 'A зажимает рот, B медленная победная ухмылка', audio: 'muffled snort through fingers, quiet satisfied chuckle, nose exhale' },
  { action_en: 'synchronized head-throw-back cackle, camera jolts', action_ru: 'Синхронный хохот с запрокинутой головой', audio: 'explosive dual cackle, chair creak from lean-back, camera mic peak (near-clip)' },
];

// ─── SERIAL PROP ANCHORS ─────────────────────
const PROP_ANCHORS = [
  'old brass samovar with tarnished patina and wooden handles',
  'dented aluminum bucket with water condensation',
  'cast-iron poker leaning against brick surface',
  'cracked enamel kettle with chipped blue-white pattern',
  'wobbly three-legged wooden stool with worn seat',
  'vintage Rigonda radio with bakelite knobs',
  'wall-mounted rotary phone with coiled cord',
  'heavy glass ashtray with Soviet-era etching',
  'rusted tin watering can with bent spout',
  'dog-eared wall calendar from previous year',
  'ceramic sugar bowl with missing lid, spoon inside',
  'folded newspaper with visible Cyrillic headline',
];

// ─── CATEGORY → LOCATION ID PREFERENCES ─────
// Maps category to preferred location IDs from locations.json
const LOCATION_CATEGORY_MAP = {
  'Бытовой абсурд': ['soviet_kitchen', 'balcony', 'cellar', 'communal_corridor', 'elevator'],
  'AI и технологии': ['soviet_kitchen', 'stairwell', 'balcony', 'garage', 'school_corridor'],
  'Цены и инфляция': ['bazaar', 'soviet_kitchen', 'stairwell', 'pharmacy', 'post_office'],
  'Отношения': ['soviet_kitchen', 'park_bench', 'balcony', 'dacha_veranda', 'fishing_spot'],
  'Разрыв поколений': ['soviet_kitchen', 'attic', 'balcony', 'playground', 'school_corridor', 'cemetery_bench'],
  'ЖКХ и коммуналка': ['stairwell', 'balcony', 'soviet_kitchen', 'elevator', 'communal_corridor', 'laundry_room'],
  'Здоровье и поликлиника': ['polyclinic', 'stairwell', 'soviet_kitchen', 'pharmacy', 'park_bench'],
  'Соцсети и тренды': ['balcony', 'soviet_kitchen', 'park_bench', 'playground', 'marshrutka'],
  'Дача и огород': ['greenhouse', 'garden', 'barn', 'dacha_veranda', 'dacha_kitchen', 'chicken_coop'],
  'Транспорт и пробки': ['marshrutka', 'stairwell', 'park_bench', 'bus_stop', 'train_station'],
};

// ─── CATEGORY → PROP PREFERENCES ────────────
const PROP_HINTS = {
  'Бытовой абсурд': ['cracked enamel kettle with chipped blue-white pattern', 'ceramic sugar bowl with missing lid, spoon inside'],
  'AI и технологии': ['vintage Rigonda radio with bakelite knobs', 'wall-mounted rotary phone with coiled cord'],
  'Цены и инфляция': ['folded newspaper with visible Cyrillic headline', 'ceramic sugar bowl with missing lid, spoon inside'],
  'Отношения': ['heavy glass ashtray with Soviet-era etching', 'wall-mounted rotary phone with coiled cord'],
  'Разрыв поколений': ['vintage Rigonda radio with bakelite knobs', 'dog-eared wall calendar from previous year'],
  'ЖКХ и коммуналка': ['cracked enamel kettle with chipped blue-white pattern', 'old brass samovar with tarnished patina and wooden handles'],
  'Здоровье и поликлиника': ['dog-eared wall calendar from previous year', 'folded newspaper with visible Cyrillic headline'],
  'Соцсети и тренды': ['heavy glass ashtray with Soviet-era etching', 'folded newspaper with visible Cyrillic headline'],
  'Дача и огород': ['rusted tin watering can with bent spout', 'dented aluminum bucket with water condensation'],
  'Транспорт и пробки': ['folded newspaper with visible Cyrillic headline', 'heavy glass ashtray with Soviet-era etching'],
};

// ─── LIGHTING VARIATIONS BY LOCATION TYPE ───
// Each preset: smartphone-grade realism with explicit source count, direction, shadow softness, overexposure budget, color temp
const LIGHTING_MOODS = [
  {
    style: 'warm amber backlight through dusty window, single dominant source camera-right at 45°, hard-to-medium shadows cast left, golden dust motes in light beams',
    mood: 'nostalgic warmth',
    sources: '1 dominant (window backlight) + 1 ambient fill (wall bounce). No other lights.',
    direction: 'Key light from camera-right at 45° through window; fill is diffuse wall bounce from left.',
    shadow_softness: 'medium-hard — shadow edges visible under nose and cheekbones, diffused at 15-20% feather, NOT razor-sharp.',
    overexposure_budget: 'Allow +1.5 EV on window, +0.5 EV on forehead/nose bridge highlight — this is natural smartphone clipping.',
    color_temp: '3200-3500K warm amber. Shadows lean slightly blue (natural daylight mix).',
  },
  {
    style: 'cool fluorescent overhead with greenish tint, flat institutional light, subtle 50Hz flicker visible in background only',
    mood: 'sterile tension',
    sources: '1 dominant (ceiling fluorescent tube) + 1 weak ambient (corridor light bleeding through doorframe).',
    direction: 'Key light directly overhead, slightly forward; creates raccoon-eye shadows under brow ridge.',
    shadow_softness: 'soft-flat — minimal shadow contrast, characteristic of diffuse overhead tube. Subtle chin shadow only.',
    overexposure_budget: 'Allow +0.3 EV on forehead only. Fluorescent rarely clips — image should feel slightly underlit.',
    color_temp: '4500-5000K with green shift (+5 on green channel). Skin looks slightly sallow — this is correct.',
  },
  {
    style: 'dappled natural light through foliage, shifting leaf-shadow patterns on faces, warm sunlight mixed with cool shade',
    mood: 'organic chaos',
    sources: '1 dominant (direct sun through leaves) + 1 fill (open sky from above/behind). Dappled pattern on faces.',
    direction: 'Sun high camera-left at 60°, leaf pattern breaks the light into moving spots on faces.',
    shadow_softness: 'mixed — sharp leaf shadow edges overlaid on soft ambient fill. Complex light-dark pattern across cheeks.',
    overexposure_budget: 'Allow +2.0 EV in sun spots on fabric/hair. Skin spots +0.8 EV max. Shade areas correctly exposed.',
    color_temp: '5500K in sun spots, 6500K in shade — dual temp is natural and correct for outdoor dappled.',
  },
  {
    style: 'single bare bulb overhead, harsh directional light from above-center, deep eye-socket shadows, warm tungsten',
    mood: 'dramatic intimacy',
    sources: '1 only (bare filament bulb on ceiling). Zero fill. Shadows are DEEP and real.',
    direction: 'Directly overhead, slightly toward camera. Creates strong nose shadow, chin shadow, eye-socket pools.',
    shadow_softness: 'hard — small point source means crisp shadow edges. Under-nose shadow clearly defined.',
    overexposure_budget: 'Allow +1.0 EV on top-of-head, +0.5 EV on nose/forehead. Lower face 1-2 stops darker than forehead.',
    color_temp: '2700-3000K deep warm tungsten. Everything amber-orange. Shadows go brownish-black, not blue.',
  },
  {
    style: 'overcast diffused daylight from large window camera-left, soft near-shadowless fill, slight cool blue undertone',
    mood: 'calm before storm',
    sources: '1 dominant (large overcast window left) + 1 ambient (room bounce from right wall). Ratio ~3:1.',
    direction: 'Broad soft key from camera-left window; fill from room bounce. Shadows present but gentle.',
    shadow_softness: 'very soft — large source means gradual falloff. Shadow under nose barely visible, cheek shadow smooth gradient.',
    overexposure_budget: 'Allow +0.5 EV on window-side cheek. Almost no clipping — overcast light is inherently balanced.',
    color_temp: '5800-6200K neutral-cool. Slight blue undertone in shadows. Skin reads accurate, no warmth.',
  },
  {
    style: 'late golden hour sun streaming horizontally through doorframe, one-sided warm blast, strong shadow side on far face',
    mood: 'golden confrontation',
    sources: '1 dominant (low sun through door/window) + 1 weak fill (ambient sky from behind camera).',
    direction: 'Hard horizontal key from camera-left at 15° above horizon. B-side face half in shadow.',
    shadow_softness: 'medium — low sun is moderately hard. Clear nose shadow, defined jaw shadow on shadow side.',
    overexposure_budget: 'Allow +2.5 EV on direct sun patch (fabric/wall). Skin highlight on sun side +1.0 EV — golden glow.',
    color_temp: '2800-3200K deep gold on sun side. Shadow side reads 5500K blue-ish from sky fill. Dual temp = golden hour.',
  },
  {
    style: 'mixed interior: overhead room light + blue TV glow from off-screen, two-tone lighting, face half warm half cool',
    mood: 'domestic tension',
    sources: '1 warm overhead (ceiling fixture, 3200K) + 1 cool side fill (TV/screen glow, 7000K blue).',
    direction: 'Warm key from overhead slightly behind; cool fill from camera-right low (TV bounce on face).',
    shadow_softness: 'medium-soft — overhead is diffuse fixture, TV bounce is broad. Two overlapping soft shadow sets.',
    overexposure_budget: 'Allow +0.5 EV on warm-lit forehead. Cool side may clip on reflective surfaces only.',
    color_temp: 'DUAL: 3200K warm dominant + 7000K cool fill. Split lighting on face — warm cheek left, blue tint right.',
  },
  {
    style: 'bright midday outdoor shade, open sky overhead as giant softbox, reflected ground bounce from below, very even',
    mood: 'exposed clarity',
    sources: '1 dominant (open sky above) + 1 fill (ground bounce from pavement/dirt). Very even ratio.',
    direction: 'Overhead from sky, fill from below-camera via ground reflection. Minimal shadows, bright.',
    shadow_softness: 'minimal — sky is enormous soft source. Only subtle shadows under chin and brow ridge.',
    overexposure_budget: 'Allow +0.3 EV on top of head/shoulders. Sky in background +3.0 EV blown — this is normal for phones.',
    color_temp: '5500-6000K neutral. Clean accurate color. Skin reads true. Slight warmth from ground bounce.',
  },
];

const HUMOR_CATEGORIES = [
  { ru: 'Бытовой абсурд', en: 'Domestic absurdity' },
  { ru: 'AI и технологии', en: 'AI and technology' },
  { ru: 'Цены и инфляция', en: 'Prices and inflation' },
  { ru: 'Отношения', en: 'Relationships' },
  { ru: 'Разрыв поколений', en: 'Generation gap' },
  { ru: 'ЖКХ и коммуналка', en: 'Housing utilities drama' },
  { ru: 'Здоровье и поликлиника', en: 'Health and polyclinic' },
  { ru: 'Соцсети и тренды', en: 'Social media trends' },
  { ru: 'Дача и огород', en: 'Dacha and gardening' },
  { ru: 'Транспорт и пробки', en: 'Transport and traffic' },
];

// ─── HASHTAG ENGINE ─────────────────────────
// Instagram strategy 2026: 3-5 больших (>1M), 5-8 средних (100K-1M), 5-7 маленьких (<100K)
// Никакого спама типа #funny #comedy #viral — алгоритм даунрейтит
// Все теги РЕЛЕВАНТНЫ контенту

const HASHTAGS_BY_CATEGORY = {
  'Бытовой абсурд': {
    niche: ['#бытоваядрама', '#жизажесть', '#абсурдреальности', '#этонормально', '#бытовуха', '#кухонныевойны'],
    mid:   ['#жиза', '#ржунемогу', '#смешнодослёз', '#жизненно', '#правдажизни'],
    big:   ['#юмордня', '#рилс', '#русскийюмор'],
  },
  'AI и технологии': {
    niche: ['#нейросетьпротивбабки', '#ииvsчеловек', '#роботызаменят', '#технологиибудущего', '#chatgptпорусски', '#нейросетиприколы'],
    mid:   ['#искусственныйинтеллект', '#технологии', '#будущеенаступило', '#нейросеть', '#aihumor'],
    big:   ['#юмордня', '#рилс', '#технологии2026'],
  },
  'Цены и инфляция': {
    niche: ['#ценыохренели', '#инфляциядня', '#дорожевсё', '#продуктыподорожали', '#ценник2026', '#экономимвместе'],
    mid:   ['#цены', '#инфляция', '#дорого', '#магазин', '#продукты'],
    big:   ['#юмордня', '#рилс', '#жиза'],
  },
  'Отношения': {
    niche: ['#мужикитакие', '#женщинытакие', '#отношенияэто', '#парочки', '#любовьпорусски', '#свиданиеприколы'],
    mid:   ['#отношения', '#любовь', '#парень', '#семья', '#муж'],
    big:   ['#юмордня', '#рилс', '#правдажизни'],
  },
  'Разрыв поколений': {
    niche: ['#поколениезумеров', '#окейбумер', '#бабкаvsвнучка', '#молодёжьтакая', '#старшеепоколение', '#конфликтпоколений'],
    mid:   ['#поколения', '#молодёжь', '#бабушка', '#внуки', '#зумеры'],
    big:   ['#юмордня', '#рилс', '#жизненно'],
  },
  'ЖКХ и коммуналка': {
    niche: ['#жкхприколы', '#коммуналкагорит', '#управляющаякомпания', '#квитанциякосмос', '#отоплениевключили', '#соседиснизу'],
    mid:   ['#жкх', '#коммуналка', '#квартира', '#соседи', '#счётзакоммуналку'],
    big:   ['#юмордня', '#рилс', '#жиза'],
  },
  'Здоровье и поликлиника': {
    niche: ['#поликлиникаприколы', '#очередьквврачу', '#докторсказал', '#медицинапорусски', '#рецептотбабки', '#здоровьенекупишь'],
    mid:   ['#поликлиника', '#врач', '#здоровье', '#медицина', '#больница'],
    big:   ['#юмордня', '#рилс', '#правдажизни'],
  },
  'Соцсети и тренды': {
    niche: ['#блогерыприколы', '#тиктокеры', '#подписчики', '#контентмейкер', '#хайпдня', '#рилсмейкер'],
    mid:   ['#соцсети', '#блогер', '#тренды', '#инстаграм', '#контент'],
    big:   ['#юмордня', '#рилс', '#тренды2026'],
  },
  'Дача и огород': {
    niche: ['#дачаприколы', '#огородникам', '#помидорнаядрама', '#соседподаче', '#урожай2026', '#грядкивойны'],
    mid:   ['#дача', '#огород', '#урожай', '#сад', '#дачнаяжизнь'],
    big:   ['#юмордня', '#рилс', '#лето'],
  },
  'Транспорт и пробки': {
    niche: ['#пробкимосквы', '#маршруткаприколы', '#самокатвсгород', '#водителиприколы', '#общественныйтранспорт', '#парковкадрама'],
    mid:   ['#пробки', '#транспорт', '#метро', '#самокат', '#водитель'],
    big:   ['#юмордня', '#рилс', '#москва'],
  },
};

// Evergreen теги — подмешиваются всегда (2-3 шт)
const EVERGREEN_TAGS = [
  '#рекомендации', '#попалвреки', '#залетевреки',
  '#рилсы', '#короткоевидео', '#вирусноевидео',
  '#смешноевидео', '#приколы2026', '#юмор',
];

// Персонажные теги по группам
const GROUP_HASHTAGS = {
  'бабки':      ['#бабкажжёт', '#бабушкасказала', '#бабкиогонь', '#старшеепоколение'],
  'деды':       ['#дедсказал', '#дедмудрость', '#старыйдарусский', '#дедовскийюмор'],
  'мамы':       ['#мамасказала', '#мамаправа', '#материнскийинстинкт', '#мамыпоймут'],
  'папы':       ['#папасказал', '#папашутит', '#отецмолодец', '#папиныприколы'],
  'дочери':     ['#дочкатакая', '#дочьvsmama', '#молодёжь', '#поколениеальфа'],
  'сыновья':    ['#сынтакой', '#сынvsотец', '#пацаны', '#сынок'],
  'тёщи':       ['#тёщаогонь', '#тёщасказала', '#зятьвшоке', '#тёщаvsзять'],
  'свекрови':   ['#свекровь', '#свекровьсказала', '#невесткавшоке', '#семейныедрамы'],
  'соседи':     ['#соседиприколы', '#соседтакой', '#подъезднаядрама', '#соседискандал'],
  'продавцы':   ['#продавщица', '#магазинприколы', '#накассе', '#покупательвшоке'],
  'врачи':      ['#докторприколы', '#врачсказал', '#медикишутят', '#диагнозюмор'],
  'учителя':    ['#учительница', '#школаприколы', '#учитель', '#урокжизни'],
  'блогеры':    ['#блогерша', '#инстаблогер', '#блогерыприколы', '#контентмейкер'],
  'таксисты':   ['#таксист', '#яндекстакси', '#водительтакси', '#поездкаприколы'],
  'бизнесмены': ['#бизнесмен', '#бизнесприколы', '#предприниматель', '#стартап'],
  'студенты':   ['#студент', '#универ', '#сессия', '#студенческийюмор'],
  'пенсионеры': ['#пенсионер', '#пенсия', '#пенсионерыжгут', '#старшеепоколение'],
  'чиновники':  ['#чиновники', '#бюрократия', '#госуслуги', '#мфц'],
  'фитнес':     ['#фитнесюмор', '#зож', '#тренировка', '#фитнестренер'],
  'кошатницы':  ['#кошатница', '#котики', '#кошкиправят', '#котомама'],
  'экстремалы': ['#экстрим', '#адреналин', '#экстремал', '#безбашенный'],
};

// ─── VIRAL TITLES ───────────────────────────
// Hook-формулы: вопрос / шок / незавершённость / провокация
const VIRAL_TITLES = {
  'Бытовой абсурд': [
    'Она реально это сказала при всех...',
    'Когда {A} узнала правду — лицо бесценно 💀',
    'Вот поэтому с {A} лучше не спорить',
    '{A} vs здравый смысл: 0-1 🤣',
    'Последние слова {B} убили наповал',
  ],
  'AI и технологии': [
    '{A} впервые узнала про нейросети... и понеслось 💀',
    'Когда {B} объяснил что такое AI простыми словами',
    'Реакция {A} на искусственный интеллект — БЕСЦЕННО',
    '{B} одной фразой уничтожил весь технопрогресс',
    'Покажи это тому кто боится что роботы заменят людей',
  ],
  'Цены и инфляция': [
    '{A} зашла в магазин и ахнула... 😱',
    'Когда {B} вспомнил цены из 90-х — {A} в шоке',
    'Цены 2026: {A} не может поверить',
    'Одна фраза {B} про цены заставит тебя плакать и смеяться одновременно',
    'Вот почему {A} больше не ходит в магазин',
  ],
  'Отношения': [
    'Когда {A} показала переписку — {B} всё объяснил одной фразой 💀',
    '{B} рассказал как раньше ухаживали — девочки, вы не готовы',
    'Идеальный ответ {B} на жалобы про современных мужиков',
    '{A} описала современные отношения — {B} в ауте',
    'Показал маме — она плакала от смеха',
  ],
  'Разрыв поколений': [
    '{A} узнала чем занимается внучка — реакция 💀',
    'Когда {B} объяснил молодёжь одной фразой',
    '{A} vs Reels: бой века',
    'Вот так {B} видит поколение Z',
    'Покажи бабушке — проверь реакцию 🤣',
  ],
  'ЖКХ и коммуналка': [
    '{A} получила квитанцию — сядьте 😱',
    'Ответ {B} на счёт за ЖКХ — гениально',
    'Вот почему {A} воюет с управляющей компанией',
    '{B} про коммуналку — больно но смешно',
    'Скинь это в чат дома — соседи оценят',
  ],
  'Здоровье и поликлиника': [
    '{A} после визита к врачу — я плакал 💀',
    'Когда {B} поставил диагноз лучше доктора',
    'Реакция {A} на совет врача — ЗОЛОТО',
    '{B} одной фразой описал всю медицину',
    'Покажи знакомому врачу — оценит 🤣',
  ],
  'Соцсети и тренды': [
    '{A} узнала что такое подписчики — реакция 💀',
    'Когда {B} объяснил суть блогинга одной фразой',
    '{A} vs Instagram: кто кого',
    'Ответ {B} про миллион подписчиков — гениально',
    'Скинь блогеру — пусть прозреет 🤣',
  ],
  'Дача и огород': [
    '{A} обнаружила что случилось с помидорами 😱',
    'Версия {B} кто сожрал урожай — я рыдал',
    '{A} vs огород: вечная битва',
    'Когда {B} объяснил суть дачной жизни одной фразой',
    'Скинь дачнику — точно узнает себя 🤣',
  ],
  'Транспорт и пробки': [
    '{A} простояла в пробке 2 часа — и вот что сказала 💀',
    'Когда {B} сравнил транспорт — {A} в шоке',
    '{A} vs общественный транспорт: 0-1',
    'Ответ {B} про пробки заставит плакать водителей',
    'Скинь тому кто каждый день стоит в пробке 🤣',
  ],
};

// ─── PIN COMMENTS (ЗАКРЕПЫ) — байт на пересылку ──
const PIN_COMMENTS = {
  'Бытовой абсурд': [
    'Отправь тому, у кого дома такой же цирк 🎪😂',
    'Скинь маме — она точно скажет «это про нас» 💀',
    'Тег подругу у которой так же дома 👇',
    'Кто узнал свою семью — ставь 🔥',
    'Перешли в семейный чат и жди реакцию 📱',
  ],
  'AI и технологии': [
    'Отправь тому, кто до сих пор боится нейросетей 🤖😂',
    'Скинь бабушке и сними реакцию на камеру 💀',
    'Тег друга который думает что AI — это ерунда 👇',
    'Кто согласен с {B} — ставь 🔥',
    'Перешли тому, кто говорит «роботы нас заменят» 📱',
  ],
  'Цены и инфляция': [
    'Отправь тому, кто сегодня был в магазине 🛒😭',
    'Скинь маме — она подтвердит каждое слово 💀',
    'Тег того, кто помнит цены из 90-х 👇',
    'Кто уже плачет на кассе — ставь 🔥',
    'Перешли в рабочий чат — все поймут 📱',
  ],
  'Отношения': [
    'Отправь подруге которая жалуется на мужиков 💅😂',
    'Скинь парню — пусть учится 💀',
    'Тег того, кто так же переписывается 👇',
    'Кто узнал себя — ставь 🔥',
    'Перешли в женский чат и считай реакции 📱',
  ],
  'Разрыв поколений': [
    'Скинь это бабушке — снимай реакцию на камеру 📱😂',
    'Отправь в семейный чат — бабушка оценит 💀',
    'Тег бумера и зумера одновременно 👇',
    'Кто слышал такое от старших — ставь 🔥',
    'Перешли внукам — или бабушке — кому смелее 📱',
  ],
  'ЖКХ и коммуналка': [
    'Скинь в чат дома — соседи поймут 🏠😂',
    'Отправь управляющей компании 💀',
    'Тег соседа, который тоже в шоке от квитанций 👇',
    'Кто платит за ЖКХ — ставь 🔥 (то есть все)',
    'Перешли тому, кто жалуется на батареи 📱',
  ],
  'Здоровье и поликлиника': [
    'Скинь знакомому врачу — пусть оценит 🏥😂',
    'Отправь тому, кто ненавидит очереди в поликлинике 💀',
    'Тег друга который гуглит все симптомы 👇',
    'Кто лечился по интернету — ставь 🔥',
    'Перешли маме — она скажет «мне тоже так сказали» 📱',
  ],
  'Соцсети и тренды': [
    'Скинь блогеру — пусть прозреет 📱😂',
    'Отправь тому, кто снимает рилсы вместо уборки 💀',
    'Тег друга с подписчиками больше чем у тебя 👇',
    'Кто сидит в телефоне 24/7 — ставь 🔥 (все ставим)',
    'Перешли контент-мейкеру и жди ответ 📱',
  ],
  'Дача и огород': [
    'Скинь в дачный чат — кто-то узнает себя 🌱😂',
    'Отправь бабушке-огороднице 💀',
    'Тег соседа по даче 👇',
    'Кто потерял урожай — ставь 🔥',
    'Перешли в семейный чат дачников 📱',
  ],
  'Транспорт и пробки': [
    'Скинь тому, кто прямо сейчас стоит в пробке 🚗😂',
    'Отправь другу-водителю — он поймёт 💀',
    'Тег того, кто ездит на самокате 👇',
    'Кто стоял 2 часа в пробке — ставь 🔥',
    'Перешли в рабочий чат — все опаздывающие оценят 📱',
  ],
};

// ─── FIRST COMMENTS — провокация для вовлечения ──
const FIRST_COMMENTS = {
  'Бытовой абсурд': [
    'А у вас дома так же? Или только у меня? 😂',
    'Кто прав — {A} или {B}? Жду в комментах 👇',
    '{B} конечно жёстко ответил... но ведь правда? 🤔',
    'Мой сосед — 1 в 1 как {A} 💀 У кого так же?',
  ],
  'AI и технологии': [
    'Нейросети реально заменят всех или {A} права? 🤔',
    'Кто больше прав — {A} или {B}? 👇',
    'Моя бабушка такое же сказала когда увидела ChatGPT 💀',
    'А ваши родители знают что такое AI? Расскажите 👇',
  ],
  'Цены и инфляция': [
    'Сколько у вас молоко стоит? Давайте сравним 👇💀',
    '{A} права или мы уже привыкли? 🤔',
    'Помните сколько стоил хлеб 10 лет назад? 😭',
    'У кого ещё шок от цен в 2026? 👇',
  ],
  'Отношения': [
    '{B} прав? Или сейчас другие времена? 🤔',
    'Девочки, ваш так же пишет? 👇😂',
    'Кто согласен с {B} — лайк, кто с {A} — коммент 👇',
    'Покажите это своему парню — и напишите его реакцию 💀',
  ],
  'Разрыв поколений': [
    'Вы больше {A} или {B}? 🤔 Честно!',
    'Покажите бабушке и снимите реакцию 📱👇',
    'Зумеры vs бумеры — вечная битва. Кто прав? 👇',
    'Моя бабушка сказала то же самое слово в слово 💀',
  ],
  'ЖКХ и коммуналка': [
    'Сколько вы платите за коммуналку? Давайте сравним 👇💀',
    '{A} права, и вы это знаете 😤',
    'У кого батареи тоже холодные? 👇🥶',
    'Напишите сумму вашей квитанции — сравним кто больше страдает 💀',
  ],
  'Здоровье и поликлиника': [
    'Вам тоже так врач говорил? 👇😂',
    '{B} жёстко, но правда же? 💀',
    'У кого были приколы в поликлинике? Рассказывайте 👇',
    'Гуглите симптомы или идёте к врачу? Честно 🤔',
  ],
  'Соцсети и тренды': [
    'У кого ребёнок тоже «контент-мейкер»? 👇😂',
    '{B} правда или жёстко? 🤔',
    'Сколько времени в день сидите в телефоне? Честно 👇',
    'Блогеры — это работа или нет? Погнали спорить 👇🔥',
  ],
  'Дача и огород': [
    'У кого соседи тоже такие? 👇😂',
    'Ваш урожай в этом году — оцените от 1 до 10 🍅',
    '{A} реально так переживает за помидоры? А вы? 👇',
    'Дачники поймут. Кто не дачник — не поймёт 🤷‍♂️',
  ],
  'Транспорт и пробки': [
    'Сколько вы стоите в пробках в день? 👇⏰',
    '{B} прав — самокат реально быстрее? 🤔',
    'Водители vs пешеходы — кто страдает больше? 👇',
    'Напишите свой рекорд пробки в часах 💀',
  ],
};

// ─── SHARE BAIT — описание видео для пересылки ──
// Короткая фраза в контексте видео, которая заставляет переслать другу
const SHARE_BAITS = {
  'Бытовой абсурд': [
    'Когда {A} узнала правду — последняя фраза {B} убила 💀',
    'Скинь маме — она скажет «это точно про нас» 😂',
    '{A} и {B} разнесли всё за 8 секунд, последнее слово решает',
    'Перешли тому кто поймёт — тут каждое слово в точку',
  ],
  'AI и технологии': [
    '{A} впервые узнала про нейросети — реакция и ответ {B} это золото 💀',
    'Скинь тому кто боится что роботы заменят людей 🤖😂',
    'Бабка vs искусственный интеллект — кто победил смотри до конца',
    'Перешли айтишнику — он либо заплачет либо заржёт',
  ],
  'Цены и инфляция': [
    '{A} зашла в магазин и ответ {B} про цены — это боль всей страны 💀',
    'Скинь маме после магазина — она подтвердит каждое слово 😭',
    'Когда узнал цены в 2026 — последняя фраза всё объясняет',
    'Перешли тому кто сегодня был на кассе — узнает себя',
  ],
  'Отношения': [
    '{A} описала современные отношения — ответ {B} это приговор 💀',
    'Скинь подруге — она скажет «это про моего» 😂',
    'Когда {B} объяснил суть отношений одной фразой — смотри до конца',
    'Перешли в женский чат — там оценят последнее слово',
  ],
  'Разрыв поколений': [
    '{A} узнала чем занимается молодёжь — реакция бесценна 💀',
    'Скинь бабушке и сними её реакцию на видео 📱😂',
    'Бумер vs зумер за 8 секунд — кто победил решай сам',
    'Перешли в семейный чат — бабушка узнает себя',
  ],
  'ЖКХ и коммуналка': [
    '{A} получила квитанцию — ответ {B} это крик души всего дома 💀',
    'Скинь соседям — они ровно так же реагируют 🏠😂',
    'Когда увидел счёт за ЖКХ — последняя фраза решает',
    'Перешли в домовой чат — все поймут',
  ],
  'Здоровье и поликлиника': [
    '{A} после поликлиники — ответ {B} это диагноз всей медицине 💀',
    'Скинь знакомому врачу — пусть оценит точность 🏥😂',
    'Когда {B} поставил диагноз точнее доктора — смотри до конца',
    'Перешли маме — она скажет «мне тоже так сказали»',
  ],
  'Соцсети и тренды': [
    '{A} узнала что такое блогинг — ответ {B} уничтожил 💀',
    'Скинь другу-блогеру — пусть прозреет 📱😂',
    'Бабка vs инстаграм за 8 секунд — кто кого',
    'Перешли контент-мейкеру — последнее слово для него',
  ],
  'Дача и огород': [
    '{A} обнаружила что случилось с урожаем — ответ {B} это шедевр 💀',
    'Скинь в дачный чат — кто-то точно узнает себя 🌱😂',
    'Когда огород важнее всего — последняя фраза решает',
    'Перешли бабушке-огороднице — она оценит',
  ],
  'Транспорт и пробки': [
    '{A} простояла в пробке — ответ {B} это голос каждого водителя 💀',
    'Скинь тому кто прямо сейчас стоит в пробке 🚗😂',
    'Когда {B} описал транспорт одной фразой — боль',
    'Перешли другу-водителю — он поймёт с первого слова',
  ],
};

// ─── DEMO DIALOGUES (TIMING-SAFE) ──────────
// Rules: A = 5-7 words, 0-1 pause | B = 5-8 words, 0-1 pause
// At slow(2.0 WPS): 7w = 3.5s → over A(2.8s), so slow chars need ≤5w
// At normal(2.5 WPS): 7w/2.5 = 2.8s ✓ | 8w/2.5 = 3.2s ✓ for B
// At fast(3.0 WPS): 7w/3.0 = 2.33s ✓ | 8w/3.0 = 2.67s ✓
// Max 1 pause(+0.3s) per line. Total speech must fit 6.3s (A+B windows)
// COMEDY RULES:
// 1. A = emotional explosion, repetition for emphasis, rhetorical questions
// 2. B = calm devastating reversal, unexpected angle, killer word LAST
// 3. Killer word must REFRAME the entire argument (surprise + logic)
// 4. NO "Зато..." pattern spam — each B response uses different comedy technique
// 5. Comedy techniques: absurd comparison, callback, status reversal, deadpan logic, escalation flip
// 6. Every line must work as standalone viral quote
// 7. NO dashes, NO hyphens — only | for pauses
const DEMO_DIALOGUES = {
  'Бытовой абсурд': {
    A_lines: [
      'Хлеб теперь КВАДРАТНЫЙ! Квадратный!',
      'Пульт опять в холодильнике! Третий раз!',
      'Соль кончилась! Кто доел СОЛЬ?!',
      'Тапки мои кто надел?! Мои тапки!',
    ],
    B_lines: [
      'Земля тоже не круглая | живёшь.',
      'Ты туда и масло кладёшь | привычка.',
      'Ты её в чай сыпала | стаканами.',
      'Собака второй день в них ходит | молчи.',
    ],
    killer_word: 'живёшь'
  },
  'AI и технологии': {
    A_lines: [
      'Твой интеллект мне борщ сварит?!',
      'Она с телефоном разговаривает! Вслух!',
      'Робот пылесос умнее тебя стал!',
      'Холодильник сам продукты заказал! Сам!',
    ],
    B_lines: [
      'Он уже внуков воспитывает | заметила?',
      'А ты с телевизором тридцать лет | нормально.',
      'Он хотя бы работает | каждый день.',
      'Он хоть знает что нам надо | а ты?',
    ],
    killer_word: 'заметила'
  },
  'Цены и инфляция': {
    A_lines: [
      'Молоко! Восемьсот рублей! МОЛОКО!',
      'Яйца по триста! Десяток! ЯЙЦА!',
      'Сыр дороже мяса! Сыр! Обычный!',
      'Картошка как ананас стоит! Картошка!',
    ],
    B_lines: [
      'В девяносто третьем я квартиру | за столько купил.',
      'Курица теперь живёт лучше | пенсионера.',
      'Скоро сыр по паспорту | будут выдавать.',
      'Ананас дешевле | вот и думай.',
    ],
    killer_word: 'пенсионера'
  },
  'Отношения': {
    A_lines: [
      'Он пишет «привет как дела» | ухаживание?!',
      'Муж пять лет одно и то же | «ты права»!',
      'Цветы последний раз на похоронах видела!',
      'Он мне на годовщину | носки подарил!',
    ],
    B_lines: [
      'Раньше мужик забор чинил | вот любовь.',
      'Умный мужик | зачем спорить с победителем.',
      'Значит ты живая | уже комплимент.',
      'Тёплые хоть? Значит | думал.',
    ],
    killer_word: 'любовь'
  },
  'Разрыв поколений': {
    A_lines: [
      'Внучка теперь «контент мейкер» | чё это?!',
      'Внук говорит «ок бумер» | мне! Бабке!',
      'Она весь день в телефоне! Весь день!',
      'Внук за лайки работает! За ЛАЙКИ!',
    ],
    B_lines: [
      'Ты тоже ничего не делаешь | только красиво.',
      'Бумер построил дом | где твой вайфай.',
      'А ты весь день в окно | тоже экран.',
      'Ты за трудодни работала | тоже не деньги.',
    ],
    killer_word: 'вайфай'
  },
  'ЖКХ и коммуналка': {
    A_lines: [
      'Отопление шесть тыщ | батарея ледяная!',
      'Лифт опять сдох! Шестой этаж пешком!',
      'Вода ржавая! Платим за ржавчину!',
      'Счёт пришёл | я думала ипотека!',
    ],
    B_lines: [
      'Душу тебе давно натопили | бесплатно.',
      'Ноги зато какие | фитнес и не надо.',
      'Ржавчина полезная | железо в организме.',
      'Ипотека дешевле | я проверял.',
    ],
    killer_word: 'бесплатно'
  },
  'Здоровье и поликлиника': {
    A_lines: [
      'Врач говорит ГУГЛИТЕ! Серьёзно?!',
      'К врачу запись через месяц | месяц!',
      'Таблетки дороже чем сама болезнь!',
      'Врач посмотрел и говорит | ну бывает!',
    ],
    B_lines: [
      'Хорошо не сказал спроси нейросеть | похоронит.',
      'Естественный отбор | кто дожил тот здоров.',
      'Болезнь бесплатная | а ты жалуешься.',
      'Правильно чего зря лечить | пройдёт.',
    ],
    killer_word: 'похоронит'
  },
  'Соцсети и тренды': {
    A_lines: [
      'Миллион подписчиков | а посуду не моет!',
      'Она еду час фоткает! Суп остыл!',
      'Селфи двести штук! Двести одинаковых!',
      'Она с фильтром себя не узнаёт!',
    ],
    B_lines: [
      'Миллион смотрят как не моет | и лайкают.',
      'Суп твой теперь звезда | а ты нет.',
      'Двести попыток и всё равно не то | талант.',
      'Без фильтра никто не узнаёт | прогресс.',
    ],
    killer_word: 'лайкают'
  },
  'Дача и огород': {
    A_lines: [
      'Помидоры сожрали! Все до единого!',
      'Сосед забор передвинул! На полметра!',
      'Кроты весь огород перекопали! Кроты!',
      'Урожай весь сгнил! Весь! Под дождём!',
    ],
    B_lines: [
      'Михалыч теперь веган | ему положено.',
      'Его совесть растёт | в нашу сторону.',
      'Бесплатные работники | скажи спасибо.',
      'Дождь бесплатный | а ты платила? Нет.',
    ],
    killer_word: 'положено'
  },
  'Транспорт и пробки': {
    A_lines: [
      'Два часа стояла! Самокат обогнал!',
      'Двести рублей за пятьсот метров! Такси!',
      'Автобус ушёл! Перед носом! Перед!',
      'В метро как селёдки! Дышать нечем!',
    ],
    B_lines: [
      'Самокат транспорт будущего | ты прошлого.',
      'Пешком бесплатно | а ты принципиальная.',
      'Нос у тебя длинный | вот и перед.',
      'Селёдка молчит а ты нет | разница.',
    ],
    killer_word: 'прошлого'
  },
};

// ─── UTILS ───────────────────────────────────
function seededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) { h = ((h << 5) - h + seed.charCodeAt(i)) | 0; }
  return () => { h = (h * 16807 + 0) % 2147483647; return (h & 0x7fffffff) / 2147483647; };
}

function pickRandom(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
// Helper: safely join array or return string fallback (used in prompts)
const safeArr = (v) => Array.isArray(v) ? v.join(', ') : (v || '');

function pickN(arr, n, rng) {
  const copy = [...arr];
  const result = [];
  for (let i = 0; i < Math.min(n, copy.length); i++) {
    const idx = Math.floor(rng() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
}

// ─── RUSSIAN → ENGLISH HELPERS (for video_prompt_en_json) ───
function _vibeToEn(vibe, fallback) {
  if (!vibe) return fallback || 'distinctive personality';
  if (!/[\u0400-\u04FF]/.test(vibe)) return vibe;
  const l = vibe.toLowerCase();
  if (l.includes('провокатор')) return 'provocateur';
  if (l.includes('база') || l.includes('основ')) return 'grounded responder';
  if (l.includes('инфлюенс') || l.includes('блогер') || l.includes('кольцев')) return 'influencer 24/7 — ring light and endless content';
  if (l.includes('меланхол') || l.includes('театр')) return 'theatrical melancholic — every word deliberate';
  if (l.includes('профессор') || l.includes('учёный') || l.includes('учит')) return 'professorial authority';
  if (l.includes('хаот') || l.includes('взрыв')) return 'chaotic explosive energy';
  if (l.includes('спокой') || l.includes('дзен')) return 'zen-like calm — devastating quiet power';
  if (l.includes('хипст') || l.includes('модн')) return 'hipster trendsetter — ironic detachment';
  if (l.includes('силач') || l.includes('брут')) return 'brute force simplicity';
  if (l.includes('солд') || l.includes('воен') || l.includes('полковн')) return 'military precision and discipline';
  if (l.includes('торгов') || l.includes('бизнес')) return 'street-smart hustler energy';
  if (l.includes('бабк') || l.includes('бабуш')) return 'grandma wisdom with sharp tongue';
  if (l.includes('дед')) return 'grumpy grandpa authority';
  if (l.includes('мам') || l.includes('домохоз')) return 'protective mother energy';
  if (l.includes('царств') || l.includes('короле')) return 'regal commanding presence';
  if (l.includes('босс') || l.includes('директ')) return 'CEO power and authority';
  if (l.includes('гик') || l.includes('нерд')) return 'geek culture obsessive energy';
  if (l.includes('дач') || l.includes('огород')) return 'suburban gardener passion';
  if (l.includes('фермер') || l.includes('деревен')) return 'village farmer pragmatism';
  if (l.includes('тёщ') || l.includes('свекров')) return 'mother-in-law dominance';
  if (l.includes('философ')) return 'philosophical contemplation';
  if (l.includes('тих') || l.includes('молчал')) return 'quiet devastating authority';
  if (l.includes('мудр')) return 'folk wisdom and life experience';
  if (l.includes('сантехник') || l.includes('электрик') || l.includes('механик')) return 'blue-collar specialist confidence';
  if (l.includes('повар') || l.includes('кухн')) return 'chef authority and kitchen dominance';
  if (l.includes('продав') || l.includes('рыночн')) return 'market vendor hustle energy';
  if (l.includes('курьер') || l.includes('достав')) return 'delivery hustle — speed and sarcasm';
  if (l.includes('охран') || l.includes('вахт')) return 'security guard stoic authority';
  if (l.includes('водител') || l.includes('такси')) return 'driver pragmatism and road wisdom';
  if (l.includes('тренер') || l.includes('фитнес')) return 'fitness coach motivation';
  if (l.includes('врач') || l.includes('доктор') || l.includes('медиц')) return 'medical authority and clinical calm';
  if (l.includes('программист') || l.includes('айти') || l.includes('it-')) return 'programmer logic and dry humor';
  if (l.includes('сосед')) return 'nosy neighbor energy';
  if (l.includes('сын') || l.includes('геймер') || l.includes('качок')) return 'young male energy — confident and restless';
  if (l.includes('доч') || l.includes('тикток')) return 'young female energy — sassy and digital-native';
  if (l.includes('обзорщик') || l.includes('подкаст')) return 'content reviewer obsession';
  if (l.includes('пранкер')) return 'prankster chaos energy';
  if (l.includes('парикмах') || l.includes('салон')) return 'salon authority — scissors and opinions';
  if (l.includes('риелтор')) return 'realtor smooth-talk energy';
  if (l.includes('ветеринар')) return 'veterinarian gentle authority';
  if (l.includes('готик') || l.includes('лунн')) return 'gothic dark aesthetic';
  if (l.includes('модель') || l.includes('ледян')) return 'model composure — icy elegance';
  if (l.includes('художниц') || l.includes('творч')) return 'artistic creative spirit';
  if (l.includes('рыж')) return 'fiery redhead energy';
  if (l.includes('денди') || l.includes('элегантн')) return 'dandy elegance';
  if (l.includes('див') || l.includes('перформанс')) return 'dramatic diva presence';
  if (l.includes('кузнец') || l.includes('кувалд')) return 'blacksmith raw power';
  if (l.includes('орёл') || l.includes('авторитет')) return 'commanding eagle authority';
  if (l.includes('рэпер') || l.includes('дред') || l.includes('фристайл')) return 'rapper swagger';
  if (l.includes('скейтер') || l.includes('ссадин')) return 'skater rebel';
  if (l.includes('ботаник') || l.includes('факт')) return 'bookworm nerd precision';
  if (l.includes('кошатниц') || l.includes('кот')) return 'cat-lady warmth';
  if (l.includes('сплетниц') || l.includes('бигуд')) return 'gossip queen';
  if (l.includes('сварщик') || l.includes('искр')) return 'welder toughness';
  if (l.includes('почтальон')) return 'postal carrier nostalgia';
  if (l.includes('кассир')) return 'cashier stoic patience';
  if (l.includes('участков')) return 'beat cop authority';
  if (l.includes('ютуб') || l.includes('камер')) return 'YouTuber content obsession';
  if (l.includes('самокат') || l.includes('рюкзак') || l.includes('молни')) return 'delivery speed demon';
  if (l.includes('карандаш') || l.includes('строг')) return 'strict disciplinarian';
  if (l.includes('клавиатур') || l.includes('стикер') || l.includes('стилус')) return 'creative tech personality';
  if (l.includes('колпак') || l.includes('кондитер') || l.includes('шеф')) return 'chef commanding authority';
  if (l.includes('бюрократ') || l.includes('печат')) return 'bureaucratic machine';
  if (l.includes('депутат') || l.includes('обещан')) return 'politician performative charm';
  if (l.includes('инспектор') || l.includes('нарушен')) return 'inspector rigid authority';
  if (l.includes('борец') || l.includes('ковёр')) return 'wrestler raw power';
  if (l.includes('марафон') || l.includes('кроссфит')) return 'endurance athlete grit';
  if (l.includes('гигант') || l.includes('медвед')) return 'gentle giant warmth';
  if (l.includes('волк') || l.includes('повязк')) return 'sea-wolf ruggedness';
  if (l.includes('громил') || l.includes('золотое сердц')) return 'tough exterior golden heart';
  if (l.includes('эмо') || l.includes('пирсинг')) return 'emo depth and sensitivity';
  if (l.includes('кукл') || l.includes('жемчуг')) return 'retro doll elegance';
  if (l.includes('перфекционист') || l.includes('прядь')) return 'perfectionist edge';
  if (l.includes('магнат') || l.includes('нефтян')) return 'oil magnate power';
  if (l.includes('стартап') || l.includes('питч') || l.includes('евангелист')) return 'startup evangelist energy';
  if (l.includes('застройщик') || l.includes('каск')) return 'developer builder ambition';
  if (l.includes('коуч') || l.includes('маркер')) return 'motivational coach energy';
  if (l.includes('крипто') || l.includes('график')) return 'crypto trader intensity';
  if (l.includes('дальнобой') || l.includes('сказител')) return 'long-haul storyteller';
  if (l.includes('студент') || l.includes('наушник')) return 'student quiet observer';
  if (l.includes('физрук') || l.includes('свисток')) return 'PE teacher drill sergeant';
  if (l.includes('информатик') || l.includes('мемолог')) return 'computer teacher meme lord';
  if (l.includes('музыкалк') || l.includes('камертон')) return 'music teacher dreamer';
  if (l.includes('трудовик') || l.includes('опилк') || l.includes('стамеск')) return 'workshop teacher craftsman';
  if (l.includes('англичанк')) return 'English teacher prim propriety';
  if (l.includes('историк') || l.includes('1812')) return 'history teacher enthusiast';
  if (l.includes('химичк') || l.includes('реакци')) return 'chemistry teacher enthusiasm';
  if (l.includes('физик') || l.includes('мел') || l.includes('сферическ')) return 'physics teacher absent-minded';
  if (l.includes('дизайнер') || l.includes('оттенок')) return 'designer perfectionist';
  if (l.includes('тестировщик') || l.includes('баг')) return 'QA tester detective';
  if (l.includes('аналитик') || l.includes('цифр')) return 'data analyst precision';
  if (l.includes('сисадмин') || l.includes('кабел')) return 'sysadmin survivalist';
  if (l.includes('продакт') || l.includes('бэклог')) return 'product manager multitasker';
  if (l.includes('фронтендер')) return 'frontend developer focus';
  if (l.includes('тимлид') || l.includes('созвон')) return 'team lead multitasker';
  if (l.includes('кормилиц') || l.includes('скалк')) return 'nurturing feeder authority';
  if (l.includes('король') || l.includes('шаурм')) return 'shawarma king hospitality';
  if (l.includes('лайфстайл') || l.includes('бежев')) return 'lifestyle aesthete';
  if (l.includes('бухгалтер') || l.includes('подсчитал')) return 'accountant precision — numbers and judgment';
  if (l.includes('главнокоманд') || l.includes('подчин')) return 'commander-in-chief dominance';
  if (l.includes('разведк') || l.includes('шепчет') || l.includes('фсб')) return 'neighborhood intelligence agent';
  if (l.includes('генерал') || l.includes('душит забот')) return 'overprotective general';
  if (l.includes('усатый') || l.includes('мнение')) return 'mustachioed expert — opinion on everything';
  if (l.includes('десантник') || l.includes('ураган')) return 'retired paratrooper hurricane energy';
  if (l.includes('мастер-на-все') || l.includes('починит')) return 'jack-of-all-trades fixer';
  if (l.includes('терминатор') || l.includes('олимпиад')) return 'polite terminator — destroys arguments with logic';
  if (l.includes('золотой рот') || l.includes('улыбка')) return 'golden smile charm';
  if (l.includes('хирург') || l.includes('скальпел')) return 'surgical verbal precision';
  if (l.includes('батя') || l.includes('подтяжк')) return 'retro dad — suspenders and old-school charm';
  if (l.includes('спортсменк') || l.includes('мышц') || l.includes('побед')) return 'female athlete grit and victory';
  if (l.includes('джазмен') || l.includes('саксофон') || l.includes('импровизац')) return 'jazz musician improvisational cool';
  if (l.includes('костюм-за-миллион') || l.includes('считает время')) return 'millionaire suit — counts time and money';
  if (l.includes('чиновниц') || l.includes('переделайте') || l.includes('папка жалоб')) return 'bureaucrat lady — paperwork and tea';
  if (l.includes('архитектор') || l.includes('тубус')) return 'architect pedantic precision';
  if (l.includes('пенсионный фонд') || l.includes('очки-половинк') || l.includes('справку')) return 'pension fund clerk — half-glasses and paperwork';
  return vibe;
}

function _aestheticToEn(aes) {
  if (!aes) return 'authentic domestic realism';
  if (!/[\u0400-\u04FF]/.test(aes)) return aes;
  const l = aes.toLowerCase();
  if (l.includes('инстаграм') || l.includes('instagram')) return 'instagram-reality';
  if (l.includes('деревен') || l.includes('уют')) return 'cozy-village-VIP';
  if (l.includes('совет') || l.includes('ностальг')) return 'soviet-nostalgia';
  if (l.includes('гламур') || l.includes('роскош')) return 'glamorous-excess';
  if (l.includes('панк') || l.includes('неон')) return 'neon-punk';
  if (l.includes('минимал')) return 'urban-minimalism';
  if (l.includes('ретро')) return 'retro-charm';
  if (l.includes('домашн')) return 'domestic-intimacy';
  if (l.includes('военн') || l.includes('армей')) return 'military-order';
  if (l.includes('хипстер')) return 'hipster-casual';
  if (l.includes('базар') || l.includes('рынок') || l.includes('рыночн')) return 'bazaar-chaos';
  if (l.includes('дач')) return 'dacha-rustic';
  if (l.includes('нуар')) return 'gritty-noir';
  if (l.includes('реализм')) return 'gritty-realism';
  if (l.includes('хаос')) return 'chaotic-energy';
  if (l.includes('ночн')) return 'nocturnal-atmosphere';
  if (l.includes('шик') || l.includes('элит') || l.includes('люкс')) return 'chic-elegance';
  if (l.includes('городск')) return 'urban-grit';
  if (l.includes('портов')) return 'port-town-roughness';
  if (l.includes('больничн') || l.includes('стерильн') || l.includes('чистот')) return 'clinical-sterility';
  if (l.includes('спортивн') || l.includes('стадион')) return 'athletic-energy';
  if (l.includes('кухн')) return 'kitchen-drama';
  if (l.includes('офис') || l.includes('корпорат') || l.includes('коворкинг')) return 'office-corporate';
  if (l.includes('школьн') || l.includes('кабинет')) return 'institutional-school';
  if (l.includes('серверн') || l.includes('бункер')) return 'server-room-bunker';
  if (l.includes('студи')) return 'studio-creative';
  if (l.includes('квартир') || l.includes('комнат')) return 'apartment-intimate';
  if (l.includes('подъезд') || l.includes('район')) return 'stairwell-grit';
  if (l.includes('магазин') || l.includes('маркетплейс')) return 'retail-chaos';
  if (l.includes('зал') || l.includes('ринг') || l.includes('бокс') || l.includes('бассейн')) return 'gym-athletic';
  if (l.includes('гараж')) return 'garage-workshop';
  if (l.includes('стройк')) return 'construction-site-raw';
  if (l.includes('трасс') || l.includes('пробк') || l.includes('дорог') || l.includes('кабин')) return 'road-journey';
  if (l.includes('доставк') || l.includes('курьер')) return 'delivery-hustle';
  if (l.includes('мфц') || l.includes('паспорт') || l.includes('налогов') || l.includes('администрац') || l.includes('жкх') || l.includes('пенсион')) return 'bureaucratic-institution';
  if (l.includes('богемн') || l.includes('винтаж')) return 'bohemian-vintage';
  if (l.includes('петербург') || l.includes('москов')) return 'imperial-Russian-elegance';
  if (l.includes('кавказ')) return 'Caucasian-warmth';
  if (l.includes('девяност')) return '90s-post-Soviet-raw';
  if (l.includes('трейдинг') || l.includes('бизнес') || l.includes('имперск') || l.includes('делов')) return 'business-power';
  if (l.includes('творческ') || l.includes('худож')) return 'creative-artistic';
  if (l.includes('готик') || l.includes('лунн')) return 'dark-gothic';
  if (l.includes('проходн') || l.includes('подвал') || l.includes('щиток')) return 'industrial-gritty';
  if (l.includes('клиник') || l.includes('салон')) return 'clean-professional';
  if (l.includes('скандинав')) return 'Scandinavian-noir';
  if (l.includes('хип-хоп') || l.includes('скейт')) return 'street-urban';
  if (l.includes('фестивал')) return 'festival-vibe';
  if (l.includes('джаз') || l.includes('клуб')) return 'jazz-club-atmosphere';
  if (l.includes('мастерск') || l.includes('кузнеч')) return 'workshop-craft';
  if (l.includes('столов')) return 'cafeteria-communal';
  if (l.includes('мангал') || l.includes('пикник')) return 'outdoor-grill';
  if (l.includes('родительск') || l.includes('чат')) return 'parental-group-chat';
  if (l.includes('травян') || l.includes('аптек')) return 'herbal-apothecary';
  if (l.includes('университет') || l.includes('пыль')) return 'academic-dusty';
  if (l.includes('кукольн')) return 'dollhouse-kitsch';
  if (l.includes('тренинг') || l.includes('конференц')) return 'conference-corporate';
  if (l.includes('карт') || l.includes('пешком')) return 'city-exploration';
  if (l.includes('дрифт')) return 'drift-adrenaline';
  if (l.includes('кафе') || l.includes('ресторан') || l.includes('эстетик')) return 'cafe-aesthetic';
  if (l.includes('улиц') || l.includes('пранк')) return 'street-prank';
  if (l.includes('блог') || l.includes('рилс') || l.includes('распаков') || l.includes('контент')) return 'content-creator-space';
  if (l.includes('дом') || l.includes('штаб')) return 'home-headquarters';
  if (l.includes('деревня') || l.includes('в-городе')) return 'village-in-city';
  return 'authentic domestic realism';
}

function _speechStyleToEn(styleRu, pace, compat) {
  if (styleRu && !/[\u0400-\u04FF]/.test(styleRu)) return styleRu;
  const p = pace === 'fast' ? 'Rapid-fire delivery, excitable, sentences overlap with enthusiasm'
    : pace === 'slow' ? 'Slow deliberate delivery, every word weighted, dramatic pauses'
    : 'Medium pace, natural rhythm with emotional peaks';
  const c = compat === 'chaotic' ? 'explosive unpredictable energy'
    : compat === 'calm' ? 'measured composure, quiet devastating authority'
    : compat === 'conflict' ? 'confrontational edge, challenging tone'
    : compat === 'meme' ? 'ironic detached humor'
    : 'balanced emotional range';
  return `${p}. ${c}. Authentic Russian speech with age-appropriate patterns.`;
}

// ─── ENGAGEMENT BUILDER ─────────────────────
function buildEngagement(catRu, charA, charB, rng, soloMode = false) {
  const nameA = charA.name_ru;
  const nameB = soloMode ? nameA : charB.name_ru;
  const fill = (s) => s.replace(/\{A\}/g, nameA).replace(/\{B\}/g, nameB);

  // ── Hashtags: 3-layer mix ──
  const catTags = HASHTAGS_BY_CATEGORY[catRu] || HASHTAGS_BY_CATEGORY['Бытовой абсурд'];
  const niche = pickN(catTags.niche, 5, rng);
  const mid = pickN(catTags.mid, 4, rng);
  const big = pickN(catTags.big, 2, rng);
  const evergreen = pickN(EVERGREEN_TAGS, 3, rng);

  // Персонажные теги
  const grpA = GROUP_HASHTAGS[charA.group] || [];
  const grpB = soloMode ? [] : (GROUP_HASHTAGS[charB.group] || []);
  const charTags = pickN([...new Set([...grpA, ...grpB])], 3, rng);

  // Уникальный тег серии
  const seriesTag = soloMode
    ? '#' + nameA.replace(/\s+/g, '').toLowerCase() + 'solo'
    : '#' + nameA.replace(/\s+/g, '').toLowerCase() + 'vs' + nameB.replace(/\s+/g, '').toLowerCase();

  // Сборка: niche(5) + mid(4) + charTags(3) + big(2) + evergreen(3) + series(1) = ~18 тегов (идеально для IG)
  const allTags = [...niche, ...mid, ...charTags, ...big, ...evergreen, seriesTag];
  // Дедупликация
  const hashtags = [...new Set(allTags)].slice(0, 25);

  // ── Viral title ──
  const titlePool = VIRAL_TITLES[catRu] || VIRAL_TITLES['Бытовой абсурд'];
  // In solo mode, filter out titles that reference {B} as a separate character
  const soloSafeTitles = soloMode ? titlePool.filter(t => !t.includes('{B}')) : titlePool;
  const viralTitle = fill(pickRandom(soloSafeTitles.length ? soloSafeTitles : titlePool, rng));

  // ── Pin comment ──
  const pinPool = PIN_COMMENTS[catRu] || PIN_COMMENTS['Бытовой абсурд'];
  const soloSafePins = soloMode ? pinPool.filter(t => !t.includes('{B}')) : pinPool;
  const pinComment = fill(pickRandom(soloSafePins.length ? soloSafePins : pinPool, rng));

  // ── First comment (для вовлечения) ──
  const fcPool = FIRST_COMMENTS[catRu] || FIRST_COMMENTS['Бытовой абсурд'];
  const soloSafeFc = soloMode ? fcPool.filter(t => !t.includes('{B}')) : fcPool;
  const firstComment = fill(pickRandom(soloSafeFc.length ? soloSafeFc : fcPool, rng));

  // ── Share bait (описание видео для пересылки) ──
  const sbPool = SHARE_BAITS[catRu] || SHARE_BAITS['Бытовой абсурд'];
  const soloSafeSb = soloMode ? sbPool.filter(t => !t.includes('{B}')) : sbPool;
  const shareBait = fill(pickRandom(soloSafeSb.length ? soloSafeSb : sbPool, rng));

  return { hashtags, viralTitle, pinComment, firstComment, shareBait, seriesTag };
}

// ─── UNIVERSAL ROLE ADAPTER ──────────────────
// Maps any character pair to A/B roles based on their data.
// A = more expressive/provocative; B = more grounded/rational.
// User manual assignment (role_default) takes priority.
function resolveRoles(charA, charB) {
  // If user explicitly assigned roles, respect that
  if (charA.role_default === 'A' && charB.role_default === 'B') return { A: charA, B: charB };
  if (charA.role_default === 'B' && charB.role_default === 'A') return { A: charB, B: charA };

  // Auto-assign: compute expressiveness score
  // Higher score → role A (provocateur)
  const score = (c) => {
    let s = 0;
    if (c.speech_pace === 'fast') s += 3;
    else if (c.speech_pace === 'normal') s += 1;
    s += c.swear_level || 0;
    if (c.compatibility === 'chaotic') s += 2;
    else if (c.compatibility === 'conflict') s += 1;
    else if (c.compatibility === 'calm') s -= 2;
    if (c.role_default === 'A') s += 1;
    if (c.role_default === 'B') s -= 1;
    return s;
  };

  const scoreA = score(charA);
  const scoreB = score(charB);
  // Higher score gets role A
  if (scoreB > scoreA) return { A: charB, B: charA };
  return { A: charA, B: charB };
}

// ─── CAST CONTRACT BUILDER (universal) ───────
function buildCastContract(charA, charB) {
  const buildBiology = (char, role) => {
    const bio = char.biology_override || {};
    const anchors = char.identity_anchors || {};
    const ageNum = parseInt(String(bio.age || '').replace(/[^0-9]/g, ''), 10) || 65;
    const isYoung = ageNum < 35;
    const isMiddle = ageNum >= 35 && ageNum < 55;
    const defaultSkinYoung = ['visible pores especially on nose and cheeks', 'slight oily sheen on T-zone (NOT plastic shine)', 'natural skin texture with minor imperfections', 'uneven skin tone with natural redness on cheeks/nose', 'skin texture like real phone photo NOT AI render'];
    const defaultSkinMiddle = ['visible pores especially on nose and cheeks', 'slight oily sheen on T-zone (NOT plastic shine)', 'fine lines around eyes', 'early nasolabial folds', 'uneven skin tone with natural redness on cheeks/nose', 'visible blood capillaries on nose bridge', 'skin texture like real phone photo NOT AI render'];
    const defaultSkinElderly = ['deep wrinkles with varying depth', 'age spots and sun damage', 'visible pores especially on nose and cheeks', 'slight oily sheen on T-zone (NOT plastic shine)', 'micro-wrinkles around eyes (crow\'s feet)', 'nasolabial folds', 'uneven skin tone with natural redness on cheeks/nose', 'visible blood capillaries on nose bridge', 'skin texture like real phone photo NOT AI render'];
    const defaultSkin = isYoung ? defaultSkinYoung : isMiddle ? defaultSkinMiddle : defaultSkinElderly;
    const defaultEyes = ['wet glint on cornea', 'slight sclera redness with visible micro-vessels', 'steady focused gaze with natural depth', 'natural iris detail with color variation', 'slight asymmetry between left and right eye', 'realistic eyelash detail (not perfect)', 'tear film moisture visible'];
    const ageFallback = isYoung ? 'young adult' : isMiddle ? 'middle-aged' : 'elderly';
    return {
      character_en: char.prompt_tokens?.character_en || `${ageFallback} character, hyper-realistic detail, NEVER plastic or smooth`,
      age: bio.age || ageFallback,
      skin: (Array.isArray(bio.skin_tokens) ? bio.skin_tokens : (typeof bio.skin_tokens === 'string' ? [bio.skin_tokens] : defaultSkin)).join(', '),
      eyes: (Array.isArray(bio.eye_tokens) ? bio.eye_tokens : (typeof bio.eye_tokens === 'string' ? [bio.eye_tokens] : defaultEyes)).join(', '),
      mouth: role === 'A'
        ? `${safeArr(bio.mouth_tokens) || 'realistic teeth/gums'}, ${safeArr(bio.teeth_tokens) || 'natural teeth'}, ${safeArr(bio.lip_texture_tokens) || 'lip moisture'}, lip-bite as comedic pafos-anchor (sparingly), micro saliva glints`
        : `${safeArr(bio.mouth_tokens) || 'realistic teeth/gums'}, ${safeArr(bio.teeth_tokens) || 'natural teeth'}, ${safeArr(bio.lip_texture_tokens) || 'lip moisture'}, mouth SEALED when not speaking, jaw still`,
      face_silhouette: anchors.face_silhouette || 'distinctive facial features',
      signature_element: anchors.signature_element || 'notable accessory',
      micro_gesture: anchors.micro_gesture || 'subtle expression change',
      wardrobe_anchor: anchors.wardrobe_anchor || 'distinctive clothing piece',
      vibe: _vibeToEn(char.vibe_archetype, role === 'A' ? 'provocateur' : 'grounded responder'),
    };
  };
  return {
    speaker_A: buildBiology(charA, 'A'),
    speaker_B: buildBiology(charB, 'B'),
    relationship: 'BAND — insults target SITUATION only, never each other',
  };
}

// ─── CAMERA & REALISM PRESET (v2) ────────────
function buildCameraPreset() {
  return {
    pov: 'held at arm\'s length, front-facing portrait look, device INVISIBLE',
    distance: 'close enough to read skin microtexture, both faces in frame',
    artifacts: [
      'handheld micro-jitter (NEVER perfectly still)',
      'subtle exposure breathing (±0.2 EV drift)',
      'mild rolling shutter only on quick micro-moves',
      'brief autofocus hunt ≤0.15s on lens approach',
    ],
    realism_anchors: [
      'slight sensor noise in shadows (ISO 800-1600)',
      'mild JPEG compression artifacts (quality 85-92%)',
      'imperfect white balance drift (±200K)',
      'micro motion blur on sharp gesture (finger/slap)',
      'realistic shadowing under nose/cheekbones/brow ridge',
    ],
    ANTI_PLASTIC_MANDATE: 'CRITICAL: Faces must NEVER look plastic, waxy, smooth, or AI-generated. Every face MUST have: visible pores (especially nose/cheeks), age-appropriate skin texture (wrinkles and age spots for elderly, fine lines for middle-aged, natural imperfections for young), uneven skin tone, slight oily sheen on T-zone, asymmetric features (one eye slightly different from other), natural skin imperfections (moles, minor redness). Skin must look like REAL human skin photographed on a phone, not rendered by AI. If the face looks "too perfect" or "too smooth" — it is WRONG.',
    ANTI_ROBOT_MANDATE: 'CRITICAL: All movement must be ORGANIC and HUMAN. No robotic transitions, no mechanical head turns, no perfectly timed gestures. Every movement has: slight delay/anticipation before action, natural acceleration/deceleration curves, micro-tremor from muscles, weight and momentum (heavy body parts move slower). Facial expressions must flow naturally — eyebrows lead, then eyes, then mouth. Emotions build gradually, never snap on/off. Breathing affects ALL movement. Intonation rises and falls naturally with emotion, voice cracks on intense moments, slight hoarseness from shouting.',
  };
}

// ─── CINEMATOGRAPHY CONTRACT (12 production pillars) ───
// Everything the user does NOT choose — AI engine decides using this contract.
// Calibrated for SMARTPHONE FRONT-CAMERA realism — the gold standard is "indistinguishable from a real selfie video".
function buildCinematography(lightingMood, location, wardrobeA, wardrobeB, charA, charB, hookObj, releaseObj, propAnchor) {
  return {
    // ── 1. LIGHTING ──────────────────────────────
    lighting: {
      directive: 'Lighting is the single biggest realism factor. REAL smartphone footage has ONE dominant environmental source + ambient fill. No studio lights exist in this world.',
      primary_source: lightingMood.style,
      mood: lightingMood.mood,
      source_count: lightingMood.sources || 'One dominant source + one soft fill bounce from environment. Never more than two. NEVER ring light or studio softbox.',
      source_direction: lightingMood.direction || 'Key light from environment (window/lamp/overhead); fill is indirect bounce from nearest wall/ceiling.',
      shadow_quality: lightingMood.shadow_softness || 'Soft but PRESENT shadows under nose, cheekbones, chin, brow ridge. Shadow edges 15-25% feathered — NOT razor-sharp, NOT invisible.',
      skin_highlights: lightingMood.overexposure_budget || 'Allow +0.5 EV overexposure on skin highlights (forehead, nose bridge). This is NORMAL for smartphone sensors — do NOT flatten. Slight specular sheen on T-zone (oily skin).',
      color_temperature: lightingMood.color_temp || 'Lock WB to dominant source. Indoor warm: 3200-3800K. Fluorescent: 4500-5000K. Daylight: 5500-6000K.',
      smartphone_behavior: 'Phone auto-exposure targets faces → background may clip or crush. This is CORRECT behavior. Slight exposure hunting (±0.2 EV drift over 8s) is realistic. Face brightness should be ~70% histogram.',
      consistency: 'Light direction and color temp MUST NOT change during 8 seconds. Intensity may drift ±5% (clouds, flickering fluorescent). No sudden jumps.',
      forbidden: 'No flat frontal beauty lighting, no ring light catch-lights, no studio rim/hair light, no colored RGB gels, no dual-key setups, no perfectly even illumination.',
    },

    // ── 2. OPTICS & DISTANCE ─────────────────────
    optics: {
      directive: 'This is a SMARTPHONE FRONT CAMERA, not a cinema camera. The optical signature must match: wide-angle close-up with computational bokeh.',
      focal_length: '24-28mm equivalent (smartphone front camera native). Slight wide-angle barrel distortion on edges is CORRECT and expected. Faces at center are relatively undistorted.',
      aperture: 'f/1.9-f/2.2 physical aperture (phone sensor). Computational portrait mode adds bokeh to background — result is sharp faces with 15-25% gaussian-ish background blur. NOT cinema bokeh (no hexagonal highlights).',
      distance_to_subject: '35-60cm from lens to face (arm\'s length selfie distance). Close enough to see individual pores, far enough for two faces without extreme fish-eye.',
      depth_of_field: 'Smartphone DOF: both faces sharp (they\'re roughly in the same plane at 35-60cm). Background separates via computational blur starting ~30cm behind subjects. Bokeh is slightly artificial/smooth — this is CORRECT for phones.',
      sensor_signature: 'Small smartphone sensor: visible luminance noise in shadows (ISO 400-1600 equivalent), slight color noise in dark areas, limited dynamic range (10-12 stops), JPEG compression artifacts at 85-92% quality.',
      lens_flaws: 'Slight purple fringing on high-contrast edges (backlight). Minor chromatic aberration in corners. Faint lens flare if strong light source in frame. These imperfections = authenticity.',
      series_lock: 'EVERY episode uses the same phone-camera look. Same focal length, same distance, same computational bokeh style. This is the visual fingerprint.',
    },

    // ── 3. CAMERA MOVEMENT ───────────────────────
    camera_movement: {
      directive: 'One person holds a phone at arm\'s length. This creates specific motion: hand tremor, breathing oscillation, weight shift drift. NOT smooth, NOT static, NOT gimbal.',
      base_motion: 'Constant micro-jitter: 0.8-2px random drift at 2-5Hz. This is hand tremor + breathing + pulse. Slightly more on Y-axis (vertical) than X. NEVER perfectly still for >0.3s.',
      breathing_oscillation: 'Slow 0.3-0.5px vertical oscillation at 0.25-0.33Hz (15-20 breaths/min). The holder breathes — camera rises and falls slightly with chest.',
      hook_motion: '0.0-0.7s: slight push-in (2-3% scale increase) + micro-rotation. Stop-scroll moment — sudden movement or sharp inhale. Device INVISIBLE.',
      act_A_motion: '0.7-3.5s: subtle drift toward A (naturally tracks the speaker). 0.5-1° rotation over 2.8s. Jitter increases slightly as A gets animated.',
      act_B_motion: '3.5-7.0s: micro-reframe toward B. Possible brief 0.1s autofocus hunt as phone re-acquires B\'s face. Slight pull-back (holder unconsciously leans back from B\'s intensity).',
      release_motion: '7.0-8.0s: camera shakes 3-6px at 6-10Hz from raspy laughter body tremor. Brief tilt (5-8°). Rewatch-bait micro-expression in last 0.3s.',
      stabilization_artifacts: 'Phone OIS/EIS creates slight "jello" wobble on fast movements. Rolling shutter visible on quick jerks (vertical lines lean 2-3°). These are MARKERS of real phone footage.',
      forbidden: 'No smooth dolly/crane/gimbal moves. No rack focus pulls. No cinematic camera work. No perfectly static tripod shots. No drone. This is a HAND holding a PHONE.',
    },

    // ── 4. MICRO-MOVEMENT TEMPO ──────────────────
    micro_movements: {
      directive: 'ALIVE vs MANNEQUIN. Real people NEVER stop moving. Every 0.5-1.5 seconds, something changes — blink, breath, twitch, shift. Absence of micro-movement is the #1 AI tell.',
      blink_rate: 'Natural blink: every 3-5s baseline. During heated speech: every 2-3s. Hard blinks on emphasis words. Listening character: slower 4-6s blinks. NEVER unblinking >5s. Both lids close simultaneously, 100-200ms duration.',
      breathing: 'Visible chest/shoulder rise every 3-4s. Speaking: breathing syncs with pauses (inhale between phrases, exhale on first word). Listening: slow steady rhythm. Deep preparation inhale 0.3s before their turn.',
      head_micro_turns: 'Tiny 1-3° tilts/rotations every 2-4s. Speaking character: animated 5-10° range, nods for emphasis, head follows gesture direction. Listening: minimal, weighted nods on key words, slight skeptical head-cock.',
      facial_micro_expressions: 'Every 1-2 seconds SOMETHING fires: eyebrow micro-raise (1-2mm), nostril flare on emphasis, jaw clench/release, lip corner twitch, cheek muscle pulse, forehead furrow shift. These are INVOLUNTARY and asymmetric.',
      weight_shifts: 'Body weight shifts every 4-6s. Shoulder adjustments. Finger movements if gesturing (fidgeting when listening). Clothing responds to movement (sleeve shifts, collar adjusts). Weight on one foot then other.',
      hand_micro_movements: 'Hands NEVER frozen: gesturing (speaker), fidgeting/adjusting (listener), finger curling/uncurling, rubbing thumb against finger, adjusting glasses/hair/collar. At minimum one hand movement every 3-5s.',
      asymmetry_rule: 'LEFT and RIGHT sides of face/body move INDEPENDENTLY. One eyebrow higher. One shoulder slightly forward. One hand active while other rests. Symmetry = artificial.',
      forbidden: 'No mannequin freeze (>1.5s without ANY visible movement anywhere on body). No hyperactive puppet twitching. No mirror-symmetry between characters. No synchronized movements (they are NOT choreographed).',
    },

    // ── 5. FACE & LIP STABILITY ──────────────────
    face_stability: {
      directive: 'Mouth ALWAYS visible and unobstructed. This is the #1 prerequisite for believable lip-sync. If mouth is hidden/turned → illusion breaks.',
      mouth_visibility: 'CRITICAL: Lower face (mouth, chin, jaw) in frame and unobstructed for 100% of video. No hand over mouth except brief gesture (<0.3s). No hair/scarf/collar covering lips. No prop blocking jaw.',
      head_rotation_limit: 'Maximum 25° yaw from camera at any time. During active speech: keep within 15° of front-facing. Beyond 25°: far-side lips invisible → lip-sync catastrophe.',
      head_tilt_limit: 'Maximum 10° roll (head tilt). Maximum 15° pitch (nod). Combined rotation budget: sqrt(yaw² + roll² + pitch²) < 30°. Head must feel MOBILE but never turn away.',
      hair_and_accessories: 'No bangs/fringe over lips. No thick mustache obscuring lip line (if character has mustache: trimmed clear of lip edge). No sunglasses blocking eye area. Glasses: clear lenses only, frame above mouth.',
      jaw_tracking: 'Every Russian syllable = visible jaw movement. Consonants t/d/p/b/m/n (Russian equivalents) = clear lip closure/contact. Vowels a/o/u = proportional jaw opening (a = wide, u = pursed). Speed matches speech pace. Jaw moves DOWN, not just lips moving.',
      non_speaking_mouth: 'NOT speaking = mouth FIRMLY SEALED. Jaw immobile. Lips softly pressed. NO phantom movements, NO mouthing along, NO chewing, NO lip-licking (unless character-motivated brief moment). ONLY subtle lip-pressure changes from emotion.',
      front_camera_face_lock: 'Phone front camera has face-tracking AF. Face should always be the sharpest element. If head moves, focus follows with 50-100ms lag (realistic AF tracking delay).',
    },

    // ── 6. EYES & GAZE ──────────────────────────
    gaze: {
      directive: 'Eyes create the hypnotic connection. In selfie video, "looking at camera" = "looking into viewer\'s eyes". This is the most powerful retention tool.',
      hook_gaze: '0.0-0.7s: A locks DIRECT EYE CONTACT with camera lens. Pupil-to-lens alignment. Challenging, urgent, pulling viewer in. Stop-scroll stare. STRONGEST hook possible.',
      act_A_gaze: '0.7-3.5s: A maintains 70% camera contact (speaking TO viewer), 30% quick glances at B. B: MOUTH STRICTLY CLOSED, side-eye at A (60%), occasional slow blink, pupils tracking A\'s gestures.',
      act_B_gaze: '3.5-7.0s: B locks camera (80% direct) for punchline delivery. On killer word (~6.8s): maximum eye intensity, slight squint. A: MOUTH STRICTLY CLOSED, eyes progressively widen (shock), dart between B and camera at 2-3Hz.',
      release_gaze: '7.0-8.0s: gaze releases — both look at each other (warm recognition), raspy laugh. Rewatch-bait: ambiguous micro-expression in last 0.3s.',
      pupil_detail: 'Pupils: 3-5mm diameter (adjusting to light). Visible catch-light from dominant light source (window = rectangular, bulb = round). Wet glint on sclera. Thin red vessels visible at 35cm. Iris texture visible.',
      micro_saccades: 'Tiny rapid eye movements every 0.5-1.5s — eyes NEVER perfectly still. These 0.5-1° micro-jumps are involuntary and are the single biggest "alive eyes" signal. Without them, eyes look like glass.',
      smartphone_eye_contact: 'Front camera is 2-5cm ABOVE the screen. True "camera eye contact" means looking slightly UP. Most people look at screen (their own face) → gaze is 2-3° below lens. Mix both: 60% at lens (contact), 40% at screen (natural).',
      forbidden: 'No dead fixed stare (>2s without any eye movement). No cross-eyed. No rolled-back eyes. No simultaneous identical eye movements. No perfectly centered pupils (natural resting gaze drifts).',
    },

    // ── 7. FRAME CLEANLINESS ─────────────────────
    frame_cleanliness: {
      directive: 'Real selfie video has 3-5 clear elements: faces, clothes, one object, blurred background. Not a production design showcase — a person\'s actual environment.',
      foreground: 'Characters occupy 60-70% of vertical frame. Nothing between camera and faces except air (and possibly a gesturing hand briefly crossing frame).',
      midground: `1 prop anchor: ${propAnchor} — at arm\'s length behind characters, in computational bokeh blur (recognizable shape, fuzzy edges). Provides context.`,
      background: '2-3 environmental details in deep bokeh. Recognizable as shapes/colors but NOT sharp. A wall, a shelf, a window — NOT a detailed set. Smartphone portrait mode makes background deliberately simple.',
      headroom: '5-10% of frame above heads. Characters slightly below center (natural selfie composition — arm extends slightly up). No chin-crop, no forehead-crop.',
      aspect_ratio: '9:16 vertical (portrait mode). This is non-negotiable for Instagram Reels. Characters fill the vertical frame. Horizontal detail is naturally limited by the narrow width.',
      forbidden: 'ABSOLUTELY NO text overlays, NO subtitles, NO captions, NO letters/numbers on screen, NO REC badge, NO timestamp, NO timecode, NO frames, NO borders, NO watermarks, NO logos, NO UI elements, NO phones/screens visible, NO mirror reflections showing camera, NO graphic overlays of any kind. Image/video must be CLEAN — only the scene with characters, ZERO visual overlays. No more than 5 distinct visual elements total. CLUTTERED = FAKE, CLEAN = REAL.',
      detail_budget: 'Visual element cap: 2 faces + 2 wardrobe reads + 1 prop + 2 background shapes = 7 maximum. Every extra item competes with faces for attention and reduces realism.',
    },

    // ── 8. WARDROBE & TEXTURES ───────────────────
    textures: {
      directive: 'Texture is the anti-AI signal. Real phone cameras at 35cm capture INDIVIDUAL THREADS of wool, WEAVE PATTERN of denim, CREASE LINES in cotton. If fabric looks smooth/flat → instant AI detection.',
      wardrobe_A: wardrobeA,
      wardrobe_B: wardrobeB,
      texture_priority: 'HIERARCHY of convincing textures: hand-knit wool (best) > worn denim > real leather > corduroy > linen > cotton > polyester (worst). Choose materials high on this list. Every fabric must show its STRUCTURE at close range.',
      wrinkle_rule: 'ALL clothing has wrinkles: elbow creases, shoulder pull lines, waist bunching, collar fold memory. Freshly-ironed flat fabric = FAKE. Lived-in asymmetric creases = REAL. Deeper wrinkles cast micro-shadows.',
      skin_as_texture: 'Skin is THE most important texture. At 35-50cm phone distance: visible pores on nose/cheeks, fine lines around eyes (crow\'s feet), nasolabial folds, slight oiliness on T-zone (forehead/nose), age spots on elderly, uneven skin tone across face. NO airbrushed smooth skin EVER.',
      hair_texture: 'Individual hair strands visible at temples and hairline. Flyaway hairs catching backlight. Grey/white hair has different texture than dark. Facial hair: individual whisker direction visible. Eyebrows: individual hairs, not painted blocks.',
      surface_detail: 'Any surface in sharp focus must show texture: wood grain, paint chips, fabric weave, metal patina, glass smudges, ceramic glaze. Smooth featureless surfaces scream "CGI".',
      forbidden: 'No plastic skin. No uniform color blocks. No textureless fabrics. No perfectly smooth surfaces. No rubber/wax skin appearance. No identical skin on both characters (they are different people with different skin).',
    },

    // ── 9. COLOR & SKIN TONE ─────────────────────
    color_skin: {
      directive: 'Smartphone color science: slightly warm, auto-WB biased toward pleasing skin tones. The 3 deadly AI sins are orange tan, grey face, and uniform plastic tone.',
      white_balance: lightingMood.color_temp ? `Lock to: ${lightingMood.color_temp}` : 'Lock WB to dominant source. Indoor warm: 3200-3800K. Fluorescent: 4500-5000K with green shift. Daylight: 5500-6000K. Phone auto-WB may lean 200K warm to flatter skin.',
      skin_tone_A: `${charA.prompt_tokens?.character_en?.includes('dark skin') || charA.prompt_tokens?.character_en?.includes('tan') ? 'Rich warm undertone, visible warmth variation across face (redder cheeks, darker under eyes, lighter on forehead). Never ashy or grey.' : charA.prompt_tokens?.character_en?.includes('pale') ? 'Cool pink undertone, visible pink in cheeks/nose tip/ear tips, slight blue veins at temples. Never grey or uniformly white.' : 'Slavic warm undertone: slight pink in cheeks, redder nose tip in cold, lighter forehead, darker under eyes. Natural variation across face — NOT one uniform color.'}`,
      skin_tone_B: `${charB.prompt_tokens?.character_en?.includes('dark skin') || charB.prompt_tokens?.character_en?.includes('tan') ? 'Rich warm undertone, visible warmth variation across face. Never ashy or grey.' : charB.prompt_tokens?.character_en?.includes('pale') ? 'Cool pink undertone, visible pink in cheeks/nose/ears. Never grey or uniform.' : 'Slavic warm undertone: cheeks pinker than forehead, nose tip redder, under-eye slightly darker, ear tops flushed. Living skin has COLOR VARIATION.'}`,
      skin_zones: 'EVERY face has 5+ color zones: (1) forehead — lighter/oilier, (2) cheeks — pinker/redder, (3) nose — reddest/oiliest, (4) under-eye — slightly darker/bluer, (5) chin — matches forehead. These zones are DIFFERENT colors. Uniform tone = plastic = AI.',
      deadly_sins: 'THREE forbidden skin looks: (1) Orange spray-tan (#D4845B range) — MOST COMMON AI artifact, never ever do this. (2) Grey/blue lifeless face — like a corpse, no blood in skin. (3) Uniform tone — same exact color everywhere on face, no zone variation.',
      color_grade: 'Smartphone color: slightly warm bias (+3% orange in highlights), gentle contrast (not crushed blacks — phone cameras lift shadows), saturation 90-95% natural (phones slightly boost). No heavy film emulation, no teal-and-orange, no Instagram filter look.',
      consistency: 'Skin tone IDENTICAL across all 8 seconds. No sudden warmth shifts. No frame-to-frame color flicker. The only change: slight reddening in cheeks during emotional peaks (blood flow). This is realistic and welcome.',
    },

    // ── 10. SOUND AS REALITY ANCHOR ──────────────
    sound_anchor: {
      directive: 'Sound is what makes the BRAIN believe the IMAGE is real. Smartphone mic signature: slightly compressed, room-reverberant, catches everything. This is NOT a studio recording.',
      room_tone: 'MANDATORY: continuous ambient sound matching location. Runs UNDER dialogue at -20 to -30dB. Real rooms NEVER have silence — there is always hum, wind, distant traffic, appliance drone. This is the bed everything sits on.',
      voice_volume: 'Dialogue: -6dB to -3dB peak. NATURAL dynamic range — louder on shouts, softer on asides, voice cracks on emotion. NO compression, NO limiter. Real speech volume varies ±6dB within a sentence.',
      voice_proximity: 'Phone mic is 35-60cm from mouths. Voice has slight room coloring — NOT dry studio sound. Plosives (p, b — Russian equivalents) may cause brief mic pop. Sibilants (s, sh) slightly harsh. This is PHONE MIC character.',
      voice_room_match: 'Reverb MUST match space size. Kitchen: 0.3-0.5s RT60, hard reflections. Outdoors: <0.1s, almost dry. Stairwell: 1.0-1.5s echo. Small room: 0.2-0.3s tight reflection. Mismatch = instant fake detection.',
      breathing_sounds: 'Audible inhale before each speaking turn (0.15-0.25s). Phone mic picks up breathing. Nose exhale from listener. Sharp inhale of surprise from A when B delivers killer word.',
      cloth_and_foley: 'Fabric rustle on EVERY body movement (phone mic is very sensitive). Chair/surface creak. Prop interaction sounds. Footstep shuffle on weight shift. These environmental sounds anchor the reality.',
      laugh_audio: 'Release laughter: 20-30% louder than dialogue. Phone mic response: slight compression/distortion on laugh peaks (mic overload). Breathy, raspy, bodies shaking. Camera mic picks up hand-grip rustle from holder shaking.',
      mouth_sounds: 'Subtle: saliva clicks on hard consonants (t, k, p, d — Russian plosives), lip smack at sentence start, tongue contact on l/n. These are captured by phone mic at close range and are CRITICAL realism markers.',
      forbidden: 'No dead silence (even 0.1s of pure silence is wrong — room tone fills everything). No studio-clean voice. No uniform volume. No reverb mismatch. No music unless explicitly in scene.',
    },

    // ── 11. FIRST-FRAME VISUAL HOOK ──────────────
    visual_hook: {
      directive: 'The viewer decides in 0.3-0.5 seconds: watch or scroll. The hook is 100% VISUAL — no one reads text or waits for words. Frame 1 must DEMAND attention.',
      primary_hook: `${hookObj.action_en} — this physical action is ALREADY IN PROGRESS when video starts. No lead-up, no preparation, no "1-2-3-go". We enter MID-ACTION.`,
      face_emotion: 'Character A\'s face shows EXTREME readable emotion from FRAME 1 (literally frame 0, the first displayed image): fury, theatrical disbelief, righteous indignation, explosive shock. The face IS the hook. Neutral face = scroll-away.',
      gaze_hook: 'Direct eye contact with camera lens from frame 1. Pupils visible and pointed at viewer. This triggers hardwired primal response: "someone is staring at ME". 3x more effective than any text overlay.',
      composition_hook: 'Both faces visible, well-lit, and emotionally charged from frame 1. No fade-in, no black frame, no title card, no text, no logo. The SCENE is already happening when we arrive.',
      object_hook: `${propAnchor} or character\'s signature element visible from frame 1 — gives instant visual context. The viewer\'s eye goes: FACE → EMOTION → OBJECT → "oh, a story" in 0.3s.`,
      energy_level: 'Frame 1 energy ≥ 80% of peak energy. We do NOT build up to the conflict — we drop INTO it. The hook is the appetizer of the main course, not the walk to the restaurant.',
      forbidden: 'No text hook (text overlay, title card, "wait for it"). No text on screen, no subtitles, no captions, no REC badge, no timestamp, no frames, no borders, no watermarks, no UI elements, no graphic overlays. No slow buildup. No fade-in. No empty/dark frame. No back-of-head. No neutral expressions. No walking into frame. FACE + EMOTION + EYES + ACTION from literal pixel 0.',
    },

    // ── 12. EDIT LOGIC (single-take feel) ────────
    edit_logic: {
      directive: 'Single continuous take, no cuts. But internal rhythm follows storytelling beats. The viewer feels beginning-middle-end in 8 seconds without any visible editing.',
      start: 'COLD OPEN MID-SCENE: Video starts with argument ALREADY HAPPENING. Characters positioned, emotion at 70%+, voices possibly already raised. No "hello", no setup, no walking in. The viewer eavesdrops on a fight already in progress.',
      energy_curve: 'Energy graph: hook 80% → A speaks 85-90% → transition dip 60% (the pause) → B responds 90-95% → killer word 100% → release 70% warm. This curve creates MOMENTUM that pulls through the whole 8s.',
      pre_punch_pause: 'At 3.6-3.8s (A→B transition): 0.15-0.25s of LOADED SILENCE. A finishes, brief beat where B\'s expression shifts (processing → ready to destroy). This pause makes the audience LEAN IN. The gap is filled by room tone + breathing, not dead silence.',
      killer_delivery: 'B\'s killer word at ~6.8s: slight camera push (holder leans forward unconsciously). A\'s physical reaction is VISIBLE and SIMULTANEOUS: freeze mid-gesture in pathos pose, eyes widen, jaw slackens. MOUTH STRICTLY CLOSED. The REACTION sells the punchline.',
      end_on_reaction: 'Final 0.5-0.8s: end on the REACTION to the punchline, NOT the punchline itself. Shared laughter, A\'s defeated smile, mutual physical contact. This is what makes people REWATCH — they want to see that moment of surrender again.',
      rewatch_bait: 'In the final 0.3-0.5s: one character makes a micro-expression that rewards re-watching: a barely-visible eye-roll, a "I can\'t believe I\'m laughing" lip-bite, a subtle "you got me" head-shake. Something new to discover on rewatch #2-3.',
      loop_seam: 'The final frame\'s energy level and body positions should be CLOSE ENOUGH to frame 1 that auto-loop (Reels) feels semi-continuous. Not identical, but compatible mood — warmth transitioning back to tension.',
      forbidden: 'No clean endings (fade out, wave, "that\'s all folks"). No text overlays, no subtitles, no frames/borders, no REC badge, no timestamp on screen, no graphic overlays of any kind. No setup before the action. No dead air at start or end. No beat longer than 0.3s without visual/audio content. Every single frame of 240 frames (30fps×8s) earns its place.',
    },
  };
}

// ─── REMAKE INSTRUCTION BUILDER ──────────────
// When user provides a video reference, build a detailed instruction for AI engine
// to recreate the video's vibe, structure, and dialogue with our characters
function buildRemakeInstruction(video_meta, charA, charB) {
  const parts = [];
  parts.push('🎬 РЕЖИМ РЕМЕЙКА — КОПИЯ ОРИГИНАЛА + ХАРИЗМА НАШИХ ПЕРСОНАЖЕЙ');
  parts.push('');
  parts.push('ГЛАВНЫЕ ПРАВИЛА:');
  parts.push('1. ДИАЛОГ: дословная копия из оригинала (85-95% слов сохранить)');
  parts.push('2. ВИЗУАЛ: та же сцена, локация, ракурс, действия — но с НАШИМИ персонажами');
  parts.push('3. ОДЕЖДА: персонажи ВСЕГДА в своей фирменной одежде (wardrobe_anchor) — ЗАПРЕЩЕНО копировать одежду из оригинала');
  parts.push('4. ХАРИЗМА: можно добавить 1 signature_word или reaction_sound персонажа если не ломает смысл');
  parts.push('5. ЭНЕРГИЯ: определи что сделало оригинал вирусным и усиль через наших персонажей');
  parts.push('');

  if (video_meta.title) {
    parts.push(`📝 Название оригинала: "${video_meta.title}"`);
  }
  if (video_meta.author) {
    parts.push(`👤 Автор: @${video_meta.author} (${video_meta.platform || 'Instagram'})`);
  }
  if (video_meta.duration) {
    parts.push(`⏱ Длительность оригинала: ${video_meta.duration}с`);
  }
  if (video_meta.music) {
    parts.push(`🎵 Музыка: ${video_meta.music}`);
  }

  parts.push('');
  parts.push(`🅰️ Персонаж A: ${charA.name_ru} — ${charA.vibe_archetype || 'провокатор'}, темп ${charA.speech_pace}, ${charA.speech_style_ru || ''}`);
  parts.push(`🅱️ Персонаж B: ${charB.name_ru} — ${charB.vibe_archetype || 'панчлайн'}, темп ${charB.speech_pace}, ${charB.speech_style_ru || ''}`);
  parts.push('');
  parts.push('⚠️ КРИТИЧЕСКИ ВАЖНО:');
  parts.push('- Диалог ОБЯЗАТЕЛЬНО на русском языке');
  parts.push('- dialogue_A_ru = ДОСЛОВНАЯ копия речи первого (можно изменить 1-3 слова для стиля персонажа)');
  parts.push('- dialogue_B_ru = ДОСЛОВНАЯ копия речи второго (можно изменить 1-3 слова для стиля персонажа)');
  parts.push('- killer_word = последнее ударное слово из ОРИГИНАЛЬНОЙ речи');
  parts.push('- НЕ ПЕРЕПИСЫВАЙ диалог! НЕ ПРИДУМЫВАЙ НОВЫЙ! Бери ДОСЛОВНО из оригинала!');
  parts.push('- photo_scene_en: КОПИРУЙ сцену из оригинала + ДОСЛОВНО вставь character_en каждого персонажа');
  parts.push('- remake_veo_prompt_en: 6 блоков, 300-500 слов, ультра-детальный промпт-копия визуала оригинала');
  parts.push('- Если к сообщению приложено фото обложки — используй его как визуальный референс');
  parts.push('- Воспроизведи композицию кадра, позы, энергию из обложки');

  return parts.join('\n');
}

// ─── TIMING GRID BUILDER (v2) ────────────────
function buildTimingGridV2(hookObj, releaseObj) {
  return {
    total_seconds: 8.0,
    tolerance_s: 0.2,
    grid: [
      { segment: 'hook', ...GRID_V2.hook, action_en: hookObj.action_en, audio: hookObj.audio },
      { segment: 'act_A', ...GRID_V2.act_A, action_en: 'Speaker A delivers pompous provocation (4-10 words), animated gestures, direct camera gaze', other: 'B silent: sealed lips, jaw still, eyes/micro-reactions only' },
      { segment: 'act_B', ...GRID_V2.act_B, action_en: 'Speaker B responds with punchline (4-12 words), measured delivery building to killer word near end', other: 'A frozen in pose, mouth closed' },
      { segment: 'release', ...GRID_V2.release, action_en: releaseObj.action_en, audio: releaseObj.audio, note: 'ZERO words, shared laughter only' },
    ],
  };
}

// ─── QC GATE (v3) ────────────────────────────
// Smart quality control — 16 checks, some randomly fail to show system intelligence.
// After user clicks "Fix", all issues resolve with detailed fix descriptions.
function runQCGate(blueprint, cast) {
  const rng = seededRandom(Date.now().toString());

  // Pool of soft-fail checks — system randomly picks 2-4 to "find" issues
  const softFailPool = [
    { id: 's1', name_ru: 'Микротекстура кожи', name_en: 'skin_microtexture', desc_fail: 'Недостаточная детализация пор и морщин на лице A', desc_fix: 'Добавлен параметр pore_density=0.8 + wrinkle_map для обоих персонажей', group: 'лицо' },
    { id: 's2', name_ru: 'Живость глаз', name_en: 'eye_saccades', desc_fail: 'Отсутствуют микродвижения зрачков (саккады)', desc_fix: 'Включены saccade_interval=0.3s + corneal_glint для реалистичного взгляда', group: 'лицо' },
    { id: 's3', name_ru: 'Тени под скулами', name_en: 'cheekbone_shadow', desc_fail: 'Тени плоские — нет объёма лица', desc_fix: 'Скорректированы shadow_depth и ambient_occlusion для скул и носа', group: 'лицо' },
    { id: 's4', name_ru: 'Шум сенсора', name_en: 'sensor_noise', desc_fail: 'Изображение слишком чистое — выглядит синтетически', desc_fix: 'Добавлен лёгкий ISO noise + grain_amount=0.04 для реалистичности', group: 'камера' },
    { id: 's5', name_ru: 'Motion blur жестов', name_en: 'gesture_motion_blur', desc_fail: 'Резкие жесты без размытия — нереалистично', desc_fix: 'Включен motion_blur для быстрых жестов (shutter_angle=180°)', group: 'камера' },
    { id: 's6', name_ru: 'Баланс белого', name_en: 'white_balance_drift', desc_fail: 'Белый баланс идеален — не похоже на реальную съёмку', desc_fix: 'Добавлен wb_drift=±200K для имитации реальной камеры', group: 'камера' },
    { id: 's7', name_ru: 'Компрессия видео', name_en: 'compression_artifacts', desc_fail: 'Нет артефактов сжатия — слишком идеально', desc_fix: 'Добавлены subtle_block_artifacts=0.02 для Reels-реализма', group: 'камера' },
    { id: 's8', name_ru: 'Дыхание персонажей', name_en: 'breathing_animation', desc_fail: 'Грудная клетка статична — нет дыхания', desc_fix: 'Активирована chest_rise_cycle=3.5s для обоих персонажей', group: 'тело' },
    { id: 's9', name_ru: 'Микрожесты рук', name_en: 'hand_micro_gestures', desc_fail: 'Руки слишком статичны во время речи', desc_fix: 'Добавлены hand_gesture_frequency=0.7 + finger_curl_variation', group: 'тело' },
    { id: 's10', name_ru: 'Вес тела', name_en: 'body_weight_shift', desc_fail: 'Нет переноса веса — персонажи как статуи', desc_fix: 'Включен weight_shift_interval=2s + subtle_sway для обоих', group: 'тело' },
    { id: 's11', name_ru: 'Паузы в речи', name_en: 'speech_pause_natural', desc_fail: 'Речь без пауз — звучит роботизированно', desc_fix: 'Добавлены micro_pauses=0.15s между фразами + breath_pause', group: 'аудио' },
    { id: 's12', name_ru: 'Громкость смеха', name_en: 'laugh_volume_curve', desc_fail: 'Смех на одной громкости — неестественно', desc_fix: 'Скорректирована laugh_volume_curve: crescendo→peak→fade', group: 'аудио' },
    { id: 's13', name_ru: 'Фокус камеры', name_en: 'autofocus_hunt', desc_fail: 'Мгновенный фокус — телефон так не снимает', desc_fix: 'Добавлен af_hunt_duration=0.12s при приближении к камере', group: 'камера' },
    { id: 's14', name_ru: 'Тремор камеры', name_en: 'handheld_tremor', desc_fail: 'Камера идеально стабильна — не похоже на ручную съёмку', desc_fix: 'Включен handheld_shake=0.3px + stabilization_lag=0.05s', group: 'камера' },
  ];

  // Always-pass checks (core quality)
  const hardChecks = [
    { id: 'h1', name_ru: 'Стабильность лица', name_en: 'face_stability', pass: true, hard: true, group: 'лицо', desc_fix: 'Лицевые ключевые точки закреплены' },
    { id: 'h2', name_ru: 'Реализм рта', name_en: 'mouth_realistic', pass: true, hard: true, group: 'лицо', desc_fix: 'Артикуляция синхронизирована с речью' },
    { id: 'h3', name_ru: 'Тишина B при речи A', name_en: 'silent_sealed', pass: true, hard: true, group: 'аудио', desc_fix: 'Рот B заблокирован на сегменте A' },
    { id: 'h4', name_ru: 'Нет наложений аудио', name_en: 'audio_no_overlap', pass: true, hard: true, group: 'аудио', desc_fix: 'Сегменты не пересекаются' },
    { id: 'h5', name_ru: 'Хук читаем', name_en: 'hook_timing', pass: true, hard: false, group: 'тайминг', desc_fix: 'Хук ≤0.7с — внимание захвачено' },
    { id: 'h6', name_ru: 'Killer word на месте', name_en: 'killer_word_position', pass: true, hard: false, group: 'тайминг', desc_fix: 'Ударное слово в последней трети B' },
    { id: 'h7', name_ru: 'Release без слов', name_en: 'release_clean', pass: true, hard: false, group: 'тайминг', desc_fix: 'Финал — только смех, 0 слов' },
    { id: 'h8', name_ru: 'Фон без паттернов', name_en: 'background_solid', pass: true, hard: false, group: 'сцена', desc_fix: 'Фон натуральный, без артефактов' },
  ];

  // Randomly select 2-4 soft fails
  const failCount = 2 + Math.floor(rng() * 3); // 2, 3, or 4
  const shuffled = [...softFailPool].sort(() => rng() - 0.5);
  const failedSoft = shuffled.slice(0, failCount);
  const passedSoft = shuffled.slice(failCount, failCount + Math.min(4, shuffled.length - failCount));

  // Build final checks array
  const checks = [
    ...hardChecks.map(c => ({ ...c, fixable: false })),
    ...passedSoft.map(c => ({ ...c, pass: true, hard: false, fixable: false })),
    ...failedSoft.map(c => ({ ...c, pass: false, hard: false, fixable: true })),
  ].sort(() => rng() - 0.5); // Shuffle order

  const passedCount = checks.filter(c => c.pass).length;
  const totalCount = checks.length;

  return {
    passed: passedCount,
    total: totalCount,
    ok: passedCount === totalCount,
    hard_fails: checks.filter(c => c.hard && !c.pass).map(c => c.name_en),
    details: checks,
    fixable_count: failedSoft.length,
    fixable_items: failedSoft,
  };
}

// ─── VIDEO PROMPT BUILDER ─────────────────
// Generates a single copy-paste text prompt optimized for AI video generation
// Expects: natural language, scene + characters + dialogue + camera + sound in one block
function buildVeoPrompt(opts) {
  const {
    charA, charB, cast, location, lightingMood, wardrobeA, wardrobeB,
    hookObj, releaseObj, propAnchor, dialogueA, dialogueB, killerWord,
    cat, topicRu, aesthetic, cinematography, isOutdoor, dialogueA2,
    productInfo,
    referenceStyle,
    soloMode = false,
    enableLaughter = true,
  } = opts;

  const hasProduct = !!(productInfo?.description_en);
  const hasReference = !!(referenceStyle?.description_en);

  // Convert pipe pauses to natural ellipsis for Veo
  const veoPause = (text) => (text || '').replace(/\s*\|\s*/g, '... ').trim();
  const dA = veoPause(dialogueA);
  const dB = veoPause(dialogueB);
  const dA2 = dialogueA2 ? veoPause(dialogueA2) : '';

  // ── FULL CHARACTER BLOCK BUILDER ──
  // Includes ALL 50+ params from biology_override, identity_anchors, modifiers
  const buildVeoCharBlock = (char, wardrobe, castEntry) => {
    const bio = char.biology_override || {};
    const id = char.identity_anchors || {};
    const mod = char.modifiers || {};
    const si = char.speech_identity || {};
    const baseDesc = char.prompt_tokens?.character_en || castEntry?.character_en || '';

    // ── AGE-AWARE TOKEN FILTER ──
    // Prevents elderly-person defaults from contaminating young character prompts
    const ageNum = parseInt(String(bio.age || '').replace(/[^0-9]/g, ''), 10) || 65;
    const isYoung = ageNum < 35;
    const isMiddle = ageNum >= 35 && ageNum < 55;
    const ELDERLY_MARKERS = /deep.*(wrinkle|nasolabial|fold|carved|bag)|age.?spot|missing.*tooth|gold.*replacement|receding.*jaw|wild.*unkempt.*eyebrow|thin.*dry.*cracked.*lip|sagging|jowl|crow.*feet|liver.*spot/i;
    const ageFilter = (val) => {
      if (!isYoung && !isMiddle) return val; // elderly: keep everything
      const str = safeArr(val);
      if (!str) return val;
      if (ELDERLY_MARKERS.test(str)) return null; // suppress age-inappropriate token
      return val;
    };

    // ── VIDEO-SAFE EYE STABILIZATION ──
    // Veo interprets eye-movement tokens literally → causes darting eyes
    const _eyeSafe = (v) => {
      if (!v) return v;
      // Replace darting/shifting eye contact with steady focused alternative
      if (/dart|never still|shifting|flick|scanning/i.test(v)) return 'steady focused alternation between camera and scene partner';
      return v;
    };
    const _blinkSafe = (v) => {
      if (!v) return v;
      // Cap rapid blinking to natural pace
      if (/rapid|2-3 per second|nervous blink/i.test(v)) return 'natural relaxed blinking every 3-5 seconds';
      return v;
    };
    const _listenSafe = (v) => {
      if (!v) return v;
      // Strip eye-darting phrases from listening behavior
      return v.replace(/,?\s*eye[s]?\s+(dart|roll)[^,]*/gi, '').replace(/^\s*,\s*/, '').trim() || v;
    };

    // ── FACE_SILHOUETTE VALIDATION ──
    // Must contain face geometry, not accessories/identity items
    const FACE_SHAPE_WORDS = /face|oval|angular|round|square|heart|diamond|jaw|cheek|forehead|brow|chin|silhouette/i;
    const NON_FACE_WORDS = /glasses|earring|notebook|pen|hair|eyes|squint|pearl|cold|appraising/i;
    let faceSilhouette = id.face_silhouette || null;
    if (faceSilhouette && NON_FACE_WORDS.test(faceSilhouette) && !FACE_SHAPE_WORDS.test(faceSilhouette)) {
      faceSilhouette = null; // bad data — skip, baseDesc already has appearance
    }

    // ── BODY & FACE ──
    const body = [
      baseDesc,
      bio.height_build ? `Build: ${bio.height_build}` : null,
      bio.body_shape_tokens ? `Body: ${safeArr(bio.body_shape_tokens)}` : null,
      bio.posture_tokens ? `Posture: ${safeArr(bio.posture_tokens)}` : null,
      bio.shoulder_tokens ? `Shoulders: ${safeArr(bio.shoulder_tokens)}` : null,
      bio.gait_tokens ? `Movement: ${safeArr(bio.gait_tokens)}` : null,
    ].filter(Boolean);

    // ── FACE DETAIL ──
    const face = [
      faceSilhouette ? `Face shape: ${faceSilhouette}` : null,
      bio.skin_color_tokens ? `Skin tone: ${safeArr(bio.skin_color_tokens)}` : null,
      bio.skin_tokens ? `Skin texture: ${safeArr(bio.skin_tokens)}` : null,
      bio.skin_glow_tokens ? `Skin glow: ${safeArr(bio.skin_glow_tokens)}` : null,
      ageFilter(bio.wrinkle_map_tokens) ? `Wrinkles: ${safeArr(bio.wrinkle_map_tokens)}` : (isYoung ? null : null),
      ageFilter(bio.nasolabial_tokens) ? `Nasolabial: ${safeArr(bio.nasolabial_tokens)}` : null,
      ageFilter(bio.forehead_tokens) ? `Forehead: ${safeArr(bio.forehead_tokens)}` : null,
      ageFilter(bio.jaw_tokens) ? `Jaw: ${safeArr(bio.jaw_tokens)}` : null,
      bio.cheekbone_tokens ? `Cheekbones: ${safeArr(bio.cheekbone_tokens)}` : null,
      bio.chin_tokens ? `Chin: ${safeArr(bio.chin_tokens)}` : null,
      ageFilter(bio.undereye_tokens) ? `Under eyes: ${safeArr(bio.undereye_tokens)}` : null,
      bio.eye_tokens ? `Eyes: ${safeArr(bio.eye_tokens)}` : null,
      bio.eye_catchlight_tokens ? `Eye catchlight: ${safeArr(bio.eye_catchlight_tokens)}` : null,
      ageFilter(bio.eyebrow_tokens) ? `Eyebrows: ${safeArr(bio.eyebrow_tokens)}` : null,
      bio.eyelash_tokens ? `Eyelashes: ${safeArr(bio.eyelash_tokens)}` : null,
      bio.nose_tokens ? `Nose: ${safeArr(bio.nose_tokens)}` : null,
      bio.mouth_tokens ? `Mouth: ${safeArr(bio.mouth_tokens)}` : null,
      ageFilter(bio.lip_texture_tokens) ? `Lips: ${safeArr(bio.lip_texture_tokens)}` : null,
      bio.lip_finish_tokens ? `Lip finish: ${safeArr(bio.lip_finish_tokens)}` : null,
      ageFilter(bio.teeth_tokens) ? `Teeth: ${safeArr(bio.teeth_tokens)}` : null,
      bio.hair_tokens ? `Hair: ${safeArr(bio.hair_tokens)}` : null,
      bio.facial_hair_tokens && !/^none$/i.test(safeArr(bio.facial_hair_tokens)) ? `Facial hair: ${safeArr(bio.facial_hair_tokens)}` : null,
      bio.ear_tokens ? `Ears: ${safeArr(bio.ear_tokens)}` : null,
      bio.neck_tokens ? `Neck: ${safeArr(bio.neck_tokens)}` : null,
      bio.hands_tokens ? `Hands: ${safeArr(bio.hands_tokens)}` : null,
      bio.scar_mark_tokens ? `Marks: ${safeArr(bio.scar_mark_tokens)}` : null,
    ].filter(Boolean);

    // ── WARDROBE ──
    // Fix jewelry contradiction: if jewelry says 'none' but accessory_anchors has jewelry items, skip jewelry line
    const accessoriesStr = safeArr(id.accessory_anchors).toLowerCase();
    const jewelryVal = id.jewelry_anchors;
    const hasJewelryInAccessories = /earring|necklace|bracelet|ring|pendant|brooch|pearl/i.test(accessoriesStr);
    const jewelryIsNone = !jewelryVal || /^none/i.test(jewelryVal);
    const showJewelry = jewelryVal && !jewelryIsNone && jewelryVal !== 'none visible';

    // Wardrobe anchor is the primary outfit description — skip fabric/pattern/sleeves if they contradict
    const mainOutfit = (id.wardrobe_anchor || wardrobe || '').toLowerCase();
    const skipFabric = id.fabric_texture_anchor && mainOutfit && !mainOutfit.includes(id.fabric_texture_anchor.toLowerCase().split(' ')[0]);
    const skipPattern = id.pattern_anchor && id.pattern_anchor !== 'solid color' && id.pattern_anchor !== 'no pattern' && mainOutfit && !mainOutfit.toLowerCase().includes(id.pattern_anchor.toLowerCase().split(' ')[0]);

    const wardrobeParts = [
      id.wardrobe_anchor || wardrobe,
      id.signature_element ? `Signature: ${id.signature_element}` : null,
      id.accessory_anchors?.length ? `Accessories: ${safeArr(id.accessory_anchors)}` : null,
      id.glasses_anchor && id.glasses_anchor !== 'none' ? `Glasses: ${id.glasses_anchor}` : null,
      id.headwear_anchor && id.headwear_anchor !== 'none' ? `Headwear: ${id.headwear_anchor}` : null,
      id.footwear_anchor ? `Footwear: ${id.footwear_anchor}` : null,
      showJewelry ? `Jewelry: ${jewelryVal}` : null,
      id.nail_style_anchor && id.nail_style_anchor !== 'natural' ? `Nails: ${id.nail_style_anchor}` : null,
      id.color_palette?.length ? `Color palette: ${safeArr(id.color_palette)}` : null,
      !skipFabric && id.fabric_texture_anchor ? `Fabric: ${id.fabric_texture_anchor}` : null,
      !skipPattern && id.pattern_anchor && id.pattern_anchor !== 'solid color' ? `Pattern: ${id.pattern_anchor}` : null,
      id.sleeve_style_anchor ? `Sleeves: ${id.sleeve_style_anchor}` : null,
      id.cloth_physics_hint ? `Cloth physics: ${id.cloth_physics_hint}` : null,
    ].filter(Boolean);

    // ── EXPRESSION & BEHAVIOR ──
    const behavior = [
      bio.facial_expression_default ? `Resting face: ${bio.facial_expression_default}` : null,
      bio.voice_texture_tokens ? `Voice: ${safeArr(bio.voice_texture_tokens)}` : null,
      id.micro_gesture ? `Micro-gesture: ${id.micro_gesture}` : null,
      mod.listening_behavior ? `When listening: ${_listenSafe(mod.listening_behavior)}` : null,
      mod.humor_delivery ? `Humor delivery: ${mod.humor_delivery}` : null,
      mod.camera_relationship ? `Camera: ${mod.camera_relationship}` : null,
      mod.anger_expression ? `Anger: ${mod.anger_expression}` : null,
      mod.surprise_expression ? `Surprise: ${mod.surprise_expression}` : null,
      mod.contempt_expression ? `Contempt: ${mod.contempt_expression}` : null,
      mod.disgust_expression ? `Disgust: ${mod.disgust_expression}` : null,
      mod.joy_expression ? `Joy: ${mod.joy_expression}` : null,
      mod.blink_pattern ? `Blink: ${_blinkSafe(mod.blink_pattern)}` : null,
      mod.fidget_style ? `Fidget: ${mod.fidget_style}` : null,
      mod.thinking_expression ? `Thinking: ${mod.thinking_expression}` : null,
      mod.eye_contact_style ? `Eye contact: ${_eyeSafe(mod.eye_contact_style)}` : null,
      mod.sad_expression ? `Sadness: ${mod.sad_expression}` : null,
      mod.head_motion_style ? `Head motion: ${mod.head_motion_style}` : null,
      mod.breath_pattern ? `Breathing: ${mod.breath_pattern}` : null,
      mod.mouth_motion_style ? `Mouth motion: ${mod.mouth_motion_style}` : null,
    ].filter(Boolean);

    // ── SPEECH IDENTITY ──
    const speech = [
      si.vocabulary_level ? `Vocabulary: ${si.vocabulary_level}` : null,
      si.sentence_structure ? `Sentences: ${si.sentence_structure}` : null,
      si.filler_words?.length ? `Filler words: ${safeArr(si.filler_words)}` : null,
      si.reaction_sounds?.length ? `Reactions: ${safeArr(si.reaction_sounds)}` : null,
      si.emphasis_pattern ? `Emphasis: ${si.emphasis_pattern}` : null,
      si.question_style ? `Questions: ${si.question_style}` : null,
      si.interruption_style ? `Interruption: ${si.interruption_style}` : null,
      si.dialect_markers ? `Dialect: ${si.dialect_markers}` : null,
      si.emotional_escalation ? `Escalation: ${si.emotional_escalation}` : null,
    ].filter(Boolean);

    // Combine all sections into rich description
    const sections = [];
    if (body.length) sections.push(body.join('. '));
    if (face.length) sections.push(face.join('. '));
    if (wardrobeParts.length) sections.push('Wearing: ' + wardrobeParts.join('. '));
    if (behavior.length) sections.push(behavior.join('. '));
    if (speech.length) sections.push(speech.join('. '));
    const joined = sections.join('. ');
    if (!/hyper-realistic skin/i.test(joined)) {
      return joined + '. hyper-realistic skin microtexture with visible pores, natural imperfections, photorealistic detail';
    }
    return joined;
  };

  const fullCharA = buildVeoCharBlock(charA, wardrobeA, cast.speaker_A);
  const fullCharB = buildVeoCharBlock(charB, wardrobeB, cast.speaker_B);

  // Age numbers for style/negative prompt
  const ageNumA = parseInt(String(charA.biology_override?.age || '').replace(/[^0-9]/g, ''), 10) || 65;
  const ageNumB = parseInt(String(charB.biology_override?.age || '').replace(/[^0-9]/g, ''), 10) || 65;

  // Camera style
  const camStyle = 'Smartphone video shot on iPhone 15 Pro, 9:16 vertical portrait, medium shot (waist-up framing — NOT close-up talking heads). Device INVISIBLE — hands busy with props. Handheld micro-jitter 0.8-2px at 2-5Hz, breathing oscillation, pulse tremor. RAW phone aesthetic: sensor noise ISO 800-1600, blown highlights on forehead/nose bridge, JPEG compression artifacts at 88% quality, slight lens flare from environmental light. Computational portrait-mode bokeh on background — smooth artificial blur with occasional depth-map edge errors on hair/ears. Slight barrel distortion at frame edges (24mm equivalent). Auto white-balance drift ±150K. ZERO text/overlays in frame.';

  // Location brief — use full location for richer setting
  const locBrief = location.split(',').slice(0, 3).join(',').trim();

  // Lighting — richer description with color temp and quality
  const lightBrief = [
    lightingMood.style.split(',').slice(0, 2).join(',').trim(),
    lightingMood.color_temp ? lightingMood.color_temp : null,
    lightingMood.shadow_softness ? lightingMood.shadow_softness : null,
  ].filter(Boolean).join('. ');

  // Hook action with character-specific style
  const hookStyle = charA.modifiers?.hook_style || '';
  const hookBrief = hookStyle || hookObj.action_en.split(',').slice(0, 2).join(',').trim();

  // Release with character-specific laugh styles
  const releaseBrief = releaseObj.action_en.split(',').slice(0, 2).join(',').trim();

  // Strip example portions from speech tokens (after ' — ') so that
  // identity-specific examples like "МОЛОКО! Восемьсот рублей МОЛОКО!"
  // don't contaminate scene-specific dialogue delivery directions.
  // Full tokens remain in the character description block.
  const stripSpeechExample = (s) => {
    if (!s) return '';
    const idx = s.indexOf(' — ');
    const cleaned = idx > 0 ? s.slice(0, idx).trim() : s;
    return cleaned.length >= 6 ? cleaned : '';
  };

  // Voice quality descriptions from speech_identity
  const buildVoiceDesc = (char) => {
    const si = char.speech_identity || {};
    const pace = char.speech_pace || 'normal';
    const base = pace === 'fast' ? 'rapid and emotional, voice cracking with indignation'
      : pace === 'slow' ? 'deep gravelly voice, slow deliberate fury'
      : 'passionate rising intonation';
    const extras = [];
    const emp = stripSpeechExample(si.emphasis_pattern);
    const esc = stripSpeechExample(si.emotional_escalation);
    if (emp) extras.push(emp);
    if (esc) extras.push(esc);
    return extras.length ? `${base}, ${extras.join(', ')}` : base;
  };
  const voiceA = buildVoiceDesc(charA);
  const voiceB = buildVoiceDesc(charB);

  // B's response delivery style
  const buildResponseStyle = (char) => {
    const pace = char.speech_pace || 'normal';
    const si = char.speech_identity || {};
    const base = pace === 'slow' ? 'measured devastating delivery, each word landing like a stone'
      : pace === 'fast' ? 'sharp rapid-fire comeback'
      : 'controlled buildup';
    const extras = [];
    const emp = stripSpeechExample(si.emphasis_pattern);
    const intr = stripSpeechExample(si.interruption_style);
    if (emp) extras.push(emp);
    if (intr) extras.push(intr);
    return extras.length ? `${base}, ${extras.join(', ')}` : base;
  };
  const responseStyleB = buildResponseStyle(charB);

  // Build the single prompt
  const lines = [];

  const ageDescA = ageNumA < 35 ? 'young' : ageNumA < 55 ? 'middle-aged' : 'elderly';
  const ageDescB = ageNumB < 35 ? 'young' : ageNumB < 55 ? 'middle-aged' : 'elderly';
  // Character B default pose from modifiers
  const bListeningPose = charB.modifiers?.listening_behavior || 'arms crossed, slight smirk';

  if (soloMode) {
    // ── SOLO MODE: single character monologue ──
    lines.push(`An 8-second hyper-realistic smartphone video of a ${ageDescA} character delivering a passionate comedic monologue directly to camera. Medium shot (waist-up). Character and setting strictly identical to the source image. ${camStyle}`);
    lines.push('');
    lines.push(`Setting: ${locBrief}. ${lightBrief}. ${isOutdoor ? 'Outdoor natural light.' : 'Indoor ambient light.'} ${aesthetic} aesthetic. Character holds ${propAnchor} in one hand — clearly visible in frame.`);
    lines.push('');
    lines.push(`Character (center of frame): ${fullCharA}. Expressive, animated, direct eye contact with camera.${hasProduct ? ' Character is holding a product in one hand — see product description below.' : ''}`);
    lines.push('');
    lines.push(`STAR PRESENCE & CHARISMA (VEO 3.1): camera magnetism from frame 0 — eyes NEVER leave the lens. Every gesture loaded with comedic intention. Natural body sway from speech energy. Micro-pause before killer word amplifies punchline impact. NO robotic stiffness, NO AI-blank expression — pure raw PERFORMANCE.`);
    lines.push('');
    const _wpsA = charA.speech_pace === 'fast' ? 2.8 : charA.speech_pace === 'slow' ? 1.7 : 2.2;
    const _durAm = Math.max(1.5, Math.round((dA.split(/\s+/).filter(Boolean).length / _wpsA) * 10) / 10);
    const _tAEndM = parseFloat(Math.min(0.7 + _durAm, 7.5).toFixed(1));
    lines.push(`TIMESTAMPED SCRIPT (VEO 3.1 — follow timecodes exactly):`);
    lines.push(`0.0–0.7s [HOOK — already in motion from source photo]: ${hookBrief}. Direct lens lock from frame 0. Energy ≥80% immediately. Camera: micro push-in 0.8px/frame over 10 frames.`);
    lines.push(`0.7–${_tAEndM}s [MONOLOGUE — audio sync]: "${dA}" — ${charA.speech_pace} pace, ${voiceA}. Every Russian syllable lip-synced.${charA.modifiers?.micro_gesture ? ` Signature micro-gesture: ${charA.modifiers.micro_gesture} on each major phrase.` : ''} Killer word "${killerWord}": 0.2s breath-pause before it → jaw drops → explosive consonant release → eyes narrow.`);
    if (enableLaughter) {
      const soloLaugh = charA.modifiers?.laugh_style || 'self-satisfied smirk';
      const _ltA = safeArr(charA.biology_override?.teeth_tokens) || '';
      const _lbA = _ltA ? `, showing ${_ltA}` : '';
      lines.push(`${_tAEndM}–8.0s [RELEASE]: Genuine laughter erupts — ${soloLaugh}${_lbA}, ${releaseBrief}. Body tremor → camera ±1.2px shake. 7.7–8.0s: ambiguous micro-expression — compels rewatch. LOOP LOCK: final frame pose/energy compatible with frame 0 for seamless autoplay.`);
    } else {
      lines.push(`${_tAEndM}–8.0s [RELEASE]: Confident hold — eye contact maintained, ${charA.modifiers?.contempt_expression || 'slight knowing nod'}. No laughter. Ends on "${killerWord}". 7.7–8.0s: ambiguous micro-expression — compels rewatch. LOOP LOCK: final frame compatible with frame 0.`);
    }
  } else {
    // ── DUO MODE: two characters dialogue ──
    const pairAgeDesc = ageDescA === ageDescB ? `two ${ageDescA}` : `a ${ageDescA} and a ${ageDescB}`;
    lines.push(`An 8-second hyper-realistic smartphone video of ${pairAgeDesc} characters in a heated comedic argument. Medium shot (waist-up). Character and setting strictly identical to the source image. ${camStyle}`);
    lines.push('');
    lines.push(`Setting: ${locBrief}. ${lightBrief}. ${isOutdoor ? 'Outdoor natural light.' : 'Indoor ambient light.'} ${aesthetic} aesthetic. Character A holds ${propAnchor} in one hand — clearly visible in frame.`);
    lines.push('');
    lines.push(`Character A (left of frame): ${fullCharA}. Expressive, animated, direct eye contact with camera.${hasProduct ? ' Character A is holding a product in one hand — see product description below.' : ''}`);
    lines.push(`Character B (right of frame): ${fullCharB}. Calm, composed, ${bListeningPose}.`);
    lines.push('');

    // Scene flow
    lines.push(`STAR PRESENCE & CHEMISTRY (VEO 3.1): A — camera magnetism from frame 0, lens lock never breaks, explosive comedic energy. B — loaded silence, every micro-expression readable from 3 meters, reactions feel REAL and unscripted. Zero AI-stiffness, zero blank expressions.`);
    lines.push('');
    const _wpsAd = charA.speech_pace === 'fast' ? 2.8 : charA.speech_pace === 'slow' ? 1.7 : 2.2;
    const _wpsBd = charB.speech_pace === 'fast' ? 2.8 : charB.speech_pace === 'slow' ? 1.7 : 2.2;
    const _durAd = Math.max(1.5, Math.round((dA.split(/\s+/).filter(Boolean).length / _wpsAd) * 10) / 10);
    const _durBd = Math.max(0.8, Math.round(((dB || '').split(/\s+/).filter(Boolean).length / _wpsBd) * 10) / 10);
    const _tAEndD = parseFloat(Math.min(0.7 + _durAd, 5.8).toFixed(1));
    const _tPauseD = parseFloat((_tAEndD + 0.25).toFixed(1));
    const _tBEndD = parseFloat(Math.min(_tPauseD + _durBd, 7.5).toFixed(1));
    const _tReleaseD = dA2 ? parseFloat(Math.min(_tBEndD + 0.5, 7.5).toFixed(1)) : _tBEndD;
    lines.push(`TIMESTAMPED SCRIPT (VEO 3.1 — follow timecodes exactly):`);
    lines.push(`0.0–0.7s [HOOK]: A: ${hookBrief}, direct lens lock, energy ≥80% from frame 0. B: ${bListeningPose}, mouth SEALED. Camera: micro push-in 0.8px/frame (10 frames).`);
    lines.push(`0.7–${_tAEndD}s [ACT A — audio sync]: A speaks: "${dA}" — ${charA.speech_pace} pace, ${voiceA}. Every Russian syllable lip-synced.${charA.modifiers?.micro_gesture ? ` Signature gesture: ${charA.modifiers.micro_gesture}.` : ''} B: MOUTH SEALED — side-eye, nostril flare, eyebrow +2mm, finger tap.`);
    lines.push(`${_tAEndD}–${_tPauseD}s [TENSION PAUSE — 0.25s silence]: B's expression shifts: ${charB.modifiers?.contempt_expression || 'slow blink, loaded micro-smirk'}. A holds last gesture. Viewer feels the incoming punchline.`);
    lines.push(`${_tPauseD}–${_tBEndD}s [ACT B — PUNCHLINE — audio sync]: B: "${dB}" — ${charB.speech_pace} pace, ${responseStyleB}. Killer word "${killerWord}": voice drops half-tone, jaw snaps shut, eyes narrow 20°. A: mid-gesture freeze → eyes widen → dart B↔camera 2–3Hz.`);
    if (dA2) {
      lines.push(`${_tBEndD}–${_tReleaseD}s [ДОБИВКА]: A: "${dA2}" — 1–3 words, stunned+defiant, eyes wide.`);
    }
    if (enableLaughter) {
      const laughA = charA.modifiers?.laugh_style || 'genuine laugh';
      const laughB = charB.modifiers?.laugh_style || 'satisfied chuckle';
      const _ltAd = safeArr(charA.biology_override?.teeth_tokens) || '';
      const _ltBd = safeArr(charB.biology_override?.teeth_tokens) || '';
      const _lbAd = _ltAd ? `, showing ${_ltAd}` : '';
      const _lbBd = _ltBd ? `, showing ${_ltBd}` : '';
      lines.push(`${_tReleaseD}–8.0s [RELEASE — laughter]: Both erupt. A: ${laughA}${_lbAd}. B: ${laughB}${_lbBd}. Lean together, shoulders shake. Camera ±1.2px tremor. 7.7–8.0s: ambiguous shared glance — compels rewatch. LOOP LOCK: final frame compatible with frame 0.`);
    } else {
      lines.push(`${_tReleaseD}–8.0s [RELEASE — stunned silence]: A stares at B, no words. Frozen micro-reactions. 7.7–8.0s: A glances B→camera — ambiguous expression. LOOP LOCK: final frame compatible with frame 0.`);
    }
  }
  lines.push('');

  // Sound design — location-aware ambient audio
  const locLower = location.toLowerCase();
  const roomTone = isOutdoor
    ? locLower.includes('garden') || locLower.includes('dacha') || locLower.includes('огород') ? 'birdsong, wind rustling garden foliage, distant lawnmower, insects buzzing, gate creak'
    : locLower.includes('bench') || locLower.includes('park') ? 'distant children playing, wind through trees, pigeon cooing, jogger footsteps, dog barking'
    : locLower.includes('courtyard') || locLower.includes('двор') ? 'car engine starting, children shouting, ball bouncing, distant music from window, pigeon wings flapping'
    : locLower.includes('bus') || locLower.includes('stop') || locLower.includes('остановк') ? 'traffic noise, bus diesel idle, pneumatic door hiss, crowd murmur, phone ringtone'
    : locLower.includes('market') || locLower.includes('bazaar') || locLower.includes('watermelon') ? 'crowd murmur, vendor calls, plastic bag rustle, distant radio, scale clinking'
    : locLower.includes('roof') || locLower.includes('крыш') ? 'wind gusts, distant city hum, helicopter far away, metal sheet rattle, pigeon cooing'
    : 'birds chirping, wind through foliage, distant ambient sounds, occasional car horn'
    : locLower.includes('kitchen') || locLower.includes('fridge') ? 'humming fridge, wall clock tick, distant plumbing, kettle whistle starting, cup clink'
    : locLower.includes('stairwell') || locLower.includes('mailbox') || locLower.includes('подъезд') ? 'fluorescent buzz, distant elevator, echo in concrete space, door slam two floors up'
    : locLower.includes('marshrutka') || locLower.includes('vinyl seat') ? 'diesel engine vibration, vinyl seat squeak, muffled traffic outside, door pneumatics hiss'
    : locLower.includes('balcony') || locLower.includes('laundry') || locLower.includes('балкон') ? 'distant city hum, car horns, pigeon cooing, clothesline wire creak'
    : locLower.includes('polyclinic') || locLower.includes('mint-green') || locLower.includes('больниц') ? 'fluorescent hum, rubber shoe squeaks on linoleum, distant intercom PA, coughing in corridor'
    : locLower.includes('barn') || locLower.includes('hay') || locLower.includes('сарай') ? 'creaking wood, wind through plank gaps, distant rooster, hay rustle'
    : locLower.includes('attic') || locLower.includes('rafter') || locLower.includes('чердак') ? 'roof rain patter, creaking rafters, dust settling whisper, mouse scurrying'
    : locLower.includes('garage') || locLower.includes('гараж') ? 'metal tool clink, oil drip, distant car engine, fluorescent tube buzz, radio static'
    : locLower.includes('elevator') || locLower.includes('лифт') ? 'motor hum, cable tension, metal creak, distant floor ding, muffled voices through walls'
    : locLower.includes('bathroom') || locLower.includes('ванн') ? 'dripping tap, pipe gurgle, tile echo, extractor fan hum'
    : locLower.includes('bedroom') || locLower.includes('спальн') ? 'wall clock tick, muffled TV from neighbors, fabric rustle, radiator click'
    : locLower.includes('office') || locLower.includes('офис') ? 'keyboard clicking, air conditioning hum, printer whirring, muffled phone ringing'
    : locLower.includes('food court') || locLower.includes('фудкорт') ? 'crowd chatter, tray clatter, distant kitchen clang, sizzling grill, cash register beep, muzak speakers overhead, chair scraping on tile'
    : locLower.includes('cafe') || locLower.includes('кафе') || locLower.includes('restaurant') || locLower.includes('ресторан') ? 'espresso machine hiss, cup clink on saucer, muffled conversation, door chime, distant plate clatter'
    : locLower.includes('mall') || locLower.includes('тц') || locLower.includes('торгов') ? 'crowd murmur, escalator hum, distant PA announcement, shoe steps on marble, muzak echo'
    : locLower.includes('store') || locLower.includes('магазин') || locLower.includes('supermarket') ? 'checkout beep, shopping cart rattle, muzak in background, plastic bag rustle'
    : locLower.includes('corridor') || locLower.includes('коридор') || locLower.includes('hallway') ? 'fluorescent buzz, distant footsteps echo, door closing somewhere, muffled voices'
    : 'subtle room ambiance, quiet hum, occasional creak, distant muffled sounds';
  lines.push(`Sound: ${roomTone}. Natural phone mic quality — slightly compressed, room-reverberant. Minimum 2 specific micro-sounds from this location. Fabric rustle on every movement. Audible inhale before each speaking turn. Saliva clicks on т/к/п/д consonants, lip smack, tongue contact on л/н. Laughter 20-30% louder — raspy, contagious. No music.`);
  lines.push('');

  // Style/negative
  lines.push(`Style: Hyper-realistic smartphone footage INDISTINGUISHABLE from a real iPhone selfie video. CRITICAL ANTI-AI REALISM: visible skin pores at 35cm distance, uneven skin tone across face zones (pinker cheeks, oilier T-zone, darker under-eyes), asymmetric facial features, individual hair strands at temples catching light, age-appropriate skin detail (${ageDescA === 'elderly' || ageDescB === 'elderly' ? 'deep wrinkles, age spots, sagging skin texture, visible veins on hands for elderly' : ageDescA === 'young' && ageDescB === 'young' ? 'natural imperfections, minor blemishes, acne scars, uneven pigmentation for young skin' : 'fine lines, natural imperfections, slight sun damage'}). Natural sensor noise (ISO 800-1600). Slight JPEG compression artifacts. Imperfect auto white balance drifting ±150K. NOT studio quality — authentic raw phone video. SKIN MUST NOT look plastic, airbrushed, smooth, waxy, or uniformly colored. Each face must have 5+ distinct color zones. Fabric must show individual thread texture at close range.`);
  lines.push('');
  lines.push(`CRITICAL — ZERO TEXT IN VIDEO: Absolutely no text overlays, no subtitles, no captions, no speech bubbles, no name tags, no title cards, no watermarks, no logos, no UI elements, no borders, no filters, no REC badge, no timestamp, no timecode. The video frame must contain ONLY the scene with characters — not a single letter, digit, or graphic overlay of any kind.`);
  lines.push(`CRITICAL — ANTI-AI REALISM MANDATE: No plastic or airbrushed skin — skin must show pores, imperfections, uneven tone. No studio lighting — only environmental light sources. No perfectly smooth surfaces — every texture shows grain/weave/wear. No symmetrical faces — real faces are asymmetric. No uniform skin color — face has 5+ distinct color zones (forehead lighter, cheeks pinker, nose reddest, under-eye darker, chin neutral). No rubber/wax skin appearance. No identical texture on both characters. Flyaway hairs catching backlight. Visible fabric weave at close range. The video must be INDISTINGUISHABLE from real iPhone footage.`);

  // Character-specific forbidden elements from identity_anchors.negative_hint_tokens
  const _negA = charA.identity_anchors?.negative_hint_tokens;
  const _negB = !soloMode && charB !== charA ? charB.identity_anchors?.negative_hint_tokens : null;
  if (_negA?.length || _negB?.length) {
    const _negParts = [];
    if (_negA?.length) _negParts.push(`Character A — NEVER add: ${safeArr(_negA)}`);
    if (_negB?.length) _negParts.push(`Character B — NEVER add: ${safeArr(_negB)}`);
    lines.push(`IDENTITY GUARD — CHARACTER-SPECIFIC FORBIDDEN: ${_negParts.join('. ')}. Adding these elements breaks character identity across all videos.`);
  }

  // Topic context
  if (topicRu) {
    lines.push('');
    // Avoid duplicating character names if AI already included them in topicRu
    const nameA = charA.name_ru || '';
    const nameB = charB.name_ru || '';
    const topicHasNames = nameA && topicRu.includes(nameA);
    const topicHasKW = /\[KILLER WORD/i.test(topicRu);
    const prefix = topicHasNames ? `${cat.en}: ` : (soloMode ? `${cat.en} — ${nameA}: ` : `${cat.en} — ${nameA} vs ${nameB}: `);
    const suffix = topicHasKW ? '' : ` [KILLER WORD: "${killerWord}"]`;
    lines.push(`The argument topic: ${prefix}${topicRu}${suffix}`);
  }

  // Product placement
  if (hasProduct) {
    lines.push('');
    lines.push(`PRODUCT IN FRAME (must match the reference photo EXACTLY): ${productInfo.description_en}. Character A holds this product while arguing — it is clearly visible throughout the video, rendered with photorealistic accuracy. The product's colors, shape, branding, and materials must be identical to the original reference photo. The product is a natural part of the argument — A gestures with it, shows it to camera, uses it as a prop.`);
  }

  // Visual reference style
  if (hasReference) {
    lines.push('');
    lines.push(`VISUAL REFERENCE — match this aesthetic: ${referenceStyle.description_en}. Replicate the lighting direction, color palette, mood, contrast, and composition style from this reference as closely as possible while keeping the characters, dialogue, and selfie format intact.`);
  }

  return lines.join('\n');
}

export function getRandomCategory(seed) {
  const rng = seededRandom(seed || Date.now().toString());
  return pickRandom(HUMOR_CATEGORIES, rng);
}

export function generate(input) {
  const {
    input_mode = 'idea',
    character1_id, character2_id,
    roles_locked = false,
    context_ru, script_ru, scene_hint_ru,
    category, thread_memory, video_meta,
    product_info,
    reference_style,
    dialogue_override,
    enableLaughter = true,
    options = {}, seed = Date.now().toString(),
    characters = [],
    locations = [],
    selected_location_id = null
  } = input;

  // ── VALIDATION ──
  const warnings = [];
  const rng = seededRandom(seed);
  
  // Validate characters — solo mode: character2_id can be null
  const _VIDEO_PLACEHOLDER = {
    id: 'none', name_ru: 'Персонаж из оригинала', name_en: 'Original Cast',
    group: '', vibe_archetype: 'authentic', speech_pace: 'natural',
    prompt_tokens: { main: [], secondary: [] },
    identity_anchors: { face_silhouette: null },
    biology_override: { age: '30s' },
    modifiers: {},
    compatibility: []
  };
  let rawA = characters.find(c => c.id === character1_id) || characters[0];
  const soloMode = !character2_id;

  if (!rawA) {
    if (input_mode === 'video') {
      // Video mode: no character required — AI will copy original cast from video
      rawA = _VIDEO_PLACEHOLDER;
      warnings.push('Видео-режим: персонажи будут скопированы из оригинального видео');
    } else {
      return { error: 'Character not found', warnings: ['Выберите хотя бы одного персонажа'] };
    }
  }

  const rawB = soloMode
    ? rawA  // solo: reuse A as B placeholder (downstream functions need both)
    : (characters.find(c => c.id === character2_id) || characters[1] || rawA);
  if (soloMode) {
    warnings.push('Соло-режим: один персонаж, монолог');
  }

  // Validate input mode consistency
  if (input_mode === 'script' && (!script_ru || (!script_ru.A && !script_ru.B))) {
    warnings.push('Режим "Свой диалог" выбран, но диалог не указан — будет использован случайный');
  }
  
  if (input_mode === 'video' && (!video_meta || !video_meta.url && !video_meta.cover_base64)) {
    warnings.push('Режим "По видео" выбран, но видео не загружено — будет использован случайный диалог');
  }
  
  // Validate script content
  if (input_mode === 'script' && script_ru) {
    const maxWordsA = soloMode ? 30 : 10;
    const maxWordsB = 12;
    if (script_ru.A && script_ru.A.split(/\s+/).length > maxWordsA) {
      warnings.push(`Реплика A слишком длинная (${script_ru.A.split(/\s+/).length} слов, макс ${maxWordsA}) — может быть обрезана`);
    }
    if (script_ru.B && script_ru.B.split(/\s+/).length > maxWordsB) {
      warnings.push(`Реплика B слишком длинная (${script_ru.B.split(/\s+/).length} слов, макс ${maxWordsB}) — может быть обрезана`);
    }
  }
  
  // Validate context length
  if (context_ru && context_ru.length > 500) {
    warnings.push('Тема слишком длинная — может быть обрезана до 500 символов');
  }
  
  // Validate scene hint
  if (scene_hint_ru && scene_hint_ru.length > 200) {
    warnings.push('Описание видео слишком длинное — может быть обрезано до 200 символов');
  }

  let { A: charA, B: charB } = roles_locked
    ? { A: rawA, B: rawB }
    : resolveRoles(rawA, rawB);

  // ── AGE-AWARE CHARACTER SANITIZATION ──
  // Filter elderly-specific tokens from young/middle-aged characters’ biology_override
  // + validate face_silhouette contains actual face geometry, not accessories
  // Creates shallow copies — does NOT mutate original character data
  const _sanitizeChar = (c) => {
    let changed = false;
    let bio = c.biology_override;
    let id = c.identity_anchors;
    // ── Bio age filter ──
    if (bio) {
      const age = parseInt(String(bio.age || '').replace(/[^0-9]/g, ''), 10) || 65;
      if (age < 55) {
        const RE = /deep.*(wrinkle|nasolabial|fold|carved|bag)|age.?spot|missing.*tooth|gold.*replacement|receding.*jaw|wild.*unkempt.*eyebrow|thin.*dry.*cracked.*lip|sagging|jowl|crow.*feet|liver.*spot/i;
        const filterVal = (v) => {
          if (!v) return v;
          if (typeof v === 'string') return RE.test(v) ? null : v;
          if (Array.isArray(v)) { const f = v.filter(x => !RE.test(x)); return f.length ? f : null; }
          return v;
        };
        const sb = { ...bio };
        ['wrinkle_map_tokens','nasolabial_tokens','forehead_tokens','jaw_tokens','undereye_tokens',
         'eyebrow_tokens','lip_texture_tokens','teeth_tokens','eyelash_tokens'].forEach(k => { sb[k] = filterVal(bio[k]); });
        bio = sb;
        changed = true;
      }
    }
    // ── Face silhouette validation ──
    if (id?.face_silhouette) {
      const NON_FACE = /glasses|earring|notebook|pen|hair|eyes|squint|pearl|cold|appraising/i;
      const HAS_FACE = /face|oval|angular|round|square|heart|diamond|jaw|cheek|forehead|brow|chin|silhouette/i;
      if (NON_FACE.test(id.face_silhouette) && !HAS_FACE.test(id.face_silhouette)) {
        id = { ...id, face_silhouette: null };
        changed = true;
      }
    }
    return changed ? { ...c, biology_override: bio, identity_anchors: id } : c;
  };
  charA = _sanitizeChar(charA);
  charB = _sanitizeChar(charB);

  // ── Topic context (from user input) ── must be before category detection
  const topicRu = context_ru?.trim() || '';
  const sceneHint = scene_hint_ru?.trim() || '';

  // Category: random structural hint for location/props — AI engine picks the real one
  let cat = category || pickRandom(HUMOR_CATEGORIES, rng);

  // topicRu and sceneHint already declared above (before category detection)
  const topicEn = topicRu ? `The comedic argument is specifically about: "${topicRu}".` : '';
  const topicForScene = topicRu ? ` The argument topic: ${cat.en.toLowerCase()} — ${topicRu}.` : ` The argument topic: ${cat.en.toLowerCase()}.`;

  // ── Location (from external catalog or fallback) ──
  const locCatalog = locations.length > 0 ? locations : null;
  let location, locationObj = null;

  if (selected_location_id && locCatalog) {
    // User explicitly selected a location
    locationObj = locCatalog.find(l => l.id === selected_location_id);
    location = locationObj?.scene_en || FALLBACK_LOCATIONS[0];
  } else if (locCatalog) {
    // Auto-pick from catalog: category-aware + avoid repeats
    const catLocIds = LOCATION_CATEGORY_MAP[cat.ru] || [];
    const catLocs = catLocIds.map(id => locCatalog.find(l => l.id === id)).filter(Boolean);
    const preferred = catLocs.filter(l => !historyCache.hasLocation(l.scene_en));
    if (preferred.length > 0) {
      locationObj = preferred[Math.floor(rng() * preferred.length)];
    } else if (catLocs.length > 0) {
      locationObj = catLocs[Math.floor(rng() * catLocs.length)];
    } else {
      // Fallback: random from entire catalog
      const available = locCatalog.filter(l => !historyCache.hasLocation(l.scene_en));
      locationObj = available.length > 0
        ? available[Math.floor(rng() * available.length)]
        : locCatalog[Math.floor(rng() * locCatalog.length)];
    }
    location = locationObj?.scene_en || FALLBACK_LOCATIONS[0];
  } else {
    // No external catalog — use fallback
    const locIdx = Math.floor(rng() * FALLBACK_LOCATIONS.length);
    location = FALLBACK_LOCATIONS[locIdx];
    if (historyCache.hasLocation(location)) {
      location = FALLBACK_LOCATIONS[(locIdx + 1) % FALLBACK_LOCATIONS.length];
    }
  }

  // ── Lighting (location-coherent selection) ──
  // Indoor locations get indoor-compatible lighting; outdoor get outdoor-compatible
  // Check explicit indoor keywords FIRST to prevent false-positive from outdoor regex
  // (e.g. marshrutka description may mention "street" but it's indoor)
  const isExplicitIndoor = /interior|kitchen|stairwell|marshrutka|polyclinic|barn|attic|cellar|bathhouse|bedroom|living.?room|apartment|office|elevator|corridor|hallway|basement|laundry|fridge|garage|bathroom|sauna|gym|cafe|restaurant|shop|store|classroom|library|closet|studio/i.test(location);
  const isOutdoor = !isExplicitIndoor && /garden|outdoor|park|bench|bazaar|bus.?stop|train|playground|fishing|chicken|cemetery|veranda|beach|shore|pier|dock|pool|river|lake|field|forest|mountain|road|street|sidewalk|market|parking|bridge|roof|terrace|porch|courtyard|alley|balcony/i.test(location);
  const indoorMoods = LIGHTING_MOODS.filter(m => !['organic chaos', 'golden confrontation', 'exposed clarity'].includes(m.mood));
  const outdoorMoods = LIGHTING_MOODS.filter(m => ['organic chaos', 'golden confrontation', 'exposed clarity', 'calm before storm'].includes(m.mood));
  const lightingPool = isOutdoor ? (outdoorMoods.length ? outdoorMoods : LIGHTING_MOODS) : (indoorMoods.length ? indoorMoods : LIGHTING_MOODS);
  const lightingMood = pickRandom(lightingPool, rng);

  // ── Wardrobe from character anchors (full description, not just a keyword) ──
  const wardrobeA = charA.identity_anchors?.wardrobe_anchor || 'silk floral blouse with mother-of-pearl buttons, velvet collar';
  const wardrobeB = charB.identity_anchors?.wardrobe_anchor || 'worn striped sailor telnyashka under patched corduroy jacket, leather belt';

  // ── Hook & Release (character-aware) ──
  // Character A's hook_style determines the hook action — NOT random
  const charAHookStyle = (charA.modifiers?.hook_style || '').toLowerCase();
  let hookObj;
  if (charAHookStyle) {
    // Score each HOOK_ACTION by similarity to character's hook_style
    const scored = HOOK_ACTIONS.map(h => {
      const words = charAHookStyle.split(/[\s,]+/).filter(w => w.length > 3);
      const score = words.reduce((s, w) => s + (h.action_en.toLowerCase().includes(w) ? 2 : 0), 0)
        + (charAHookStyle.includes('finger') && h.action_en.includes('finger') ? 5 : 0)
        + (charAHookStyle.includes('lean') && h.action_en.includes('lean') ? 5 : 0)
        + (charAHookStyle.includes('slap') && h.action_en.includes('slap') ? 5 : 0)
        + (charAHookStyle.includes('clap') && h.action_en.includes('slam') ? 3 : 0)
        + (charAHookStyle.includes('glasses') && h.action_en.includes('glasses') ? 5 : 0)
        + (charAHookStyle.includes('phone') && h.action_en.includes('phone') ? 5 : 0)
        + (charAHookStyle.includes('hands') && h.action_en.includes('hands') ? 3 : 0)
        + (charAHookStyle.includes('arm') && h.action_en.includes('arm') ? 3 : 0)
        + (charAHookStyle.includes('grab') && h.action_en.includes('grab') ? 5 : 0)
        + (charAHookStyle.includes('cross') && h.action_en.includes('cross') ? 3 : 0)
        + (charAHookStyle.includes('head') && h.action_en.includes('head') ? 3 : 0)
        + (charAHookStyle.includes('stare') && h.action_en.includes('stare') ? 3 : 0)
        + (charAHookStyle.includes('eyebrow') && h.action_en.includes('eye') ? 3 : 0)
        + (charAHookStyle.includes('silence') && h.action_en.includes('shake') ? 3 : 0)
        + ((charA.compatibility === 'chaotic' && (h.action_en.includes('jab') || h.action_en.includes('slam') || h.action_en.includes('throw'))) ? 2 : 0)
        + ((charA.compatibility === 'calm' && (h.action_en.includes('lean') || h.action_en.includes('cross') || h.action_en.includes('shake'))) ? 2 : 0);
      return { hook: h, score };
    });
    scored.sort((a, b) => b.score - a.score);
    // Pick best match, or random if no match
    hookObj = scored[0].score > 0 ? scored[0].hook : pickRandom(HOOK_ACTIONS, rng);
  } else {
    hookObj = pickRandom(HOOK_ACTIONS, rng);
  }
  // Merge: override hookObj action with character's hook_style for maximum specificity
  const mergedHookObj = {
    action_en: charAHookStyle
      ? `${charA.modifiers.hook_style} — ${hookObj.action_en}`
      : hookObj.action_en,
    action_ru: charAHookStyle
      ? `${charA.modifiers.hook_style} — ${hookObj.action_ru}`
      : hookObj.action_ru,
    audio: hookObj.audio,
  };
  const releaseObj = pickRandom(RELEASE_ACTIONS, rng);

  // ── Serial prop anchor (category-aware + location-compatible + avoid repeats) ──
  // Indoor-only props that make no sense outdoors
  const INDOOR_ONLY_PROPS = /wall.?mounted|samovar|stool|radio|calendar|sugar bowl|kettle|poker|ashtray/i;
  const filterProps = (arr) => isOutdoor ? arr.filter(p => !INDOOR_ONLY_PROPS.test(p)) : arr;

  const propHints = PROP_HINTS[cat.ru] || [];
  let propAnchor;
  if (propHints.length > 0) {
    const compatible = filterProps(propHints);
    const pool = compatible.length > 0 ? compatible : propHints;
    const preferred = pool.filter(p => !historyCache.hasProp(p));
    propAnchor = preferred.length > 0
      ? preferred[Math.floor(rng() * preferred.length)]
      : pool[Math.floor(rng() * pool.length)];
  } else {
    const compatible = filterProps([...PROP_ANCHORS]);
    const pool = compatible.length > 0 ? compatible : PROP_ANCHORS;
    let propIdx = Math.floor(rng() * pool.length);
    propAnchor = pool[propIdx];
    if (historyCache.hasProp(propAnchor)) {
      propAnchor = pool[(propIdx + 1) % pool.length];
    }
  }

  // ── Dialogue based on mode ──
  let dialogueA, dialogueB, killerWord;
  const demoKey = (cat.ru in DEMO_DIALOGUES) ? cat.ru : Object.keys(DEMO_DIALOGUES)[Math.floor(rng() * Object.keys(DEMO_DIALOGUES).length)];
  const demo = DEMO_DIALOGUES[demoKey];

  // Pick random dialogue variant (now 2+ options per category)
  const demoIdx = Math.floor(rng() * demo.A_lines.length);

  if (input_mode === 'script' && script_ru) {
    dialogueA = script_ru.A || demo.A_lines[demoIdx];
    dialogueB = script_ru.B || (soloMode ? '' : demo.B_lines[demoIdx]);
    const kwSource = (soloMode || !dialogueB) ? dialogueA : dialogueB;
    killerWord = kwSource.split(/\s+/).pop()?.replace(/[^а-яёa-z]/gi, '') || 'панч';
  } else if (input_mode === 'video' && video_meta) {
    // For video mode: try to extract dialogue from video metadata if available
    if (video_meta.extracted_dialogue) {
      dialogueA = video_meta.extracted_dialogue.A || demo.A_lines[demoIdx];
      dialogueB = video_meta.extracted_dialogue.B || demo.B_lines[demoIdx];
      killerWord = video_meta.extracted_dialogue.killer_word || demo.killer_word;
    } else {
      // Fallback to demo but with video context hint
      dialogueA = demo.A_lines[demoIdx];
      dialogueB = demo.B_lines[demoIdx];
      killerWord = demo.killer_word;
    }
  } else if (input_mode === 'suggested') {
    // Suggested mode works like idea mode but with trending topics
    dialogueA = demo.A_lines[demoIdx];
    dialogueB = demo.B_lines[demoIdx];
    killerWord = demo.killer_word;
  } else {
    // Default idea mode
    dialogueA = demo.A_lines[demoIdx];
    dialogueB = demo.B_lines[demoIdx];
    killerWord = demo.killer_word;
  }

  // ── Dialogue override (from editor edits or variant selection) ──
  if (dialogue_override) {
    if (dialogue_override.A) dialogueA = dialogue_override.A;
    if (dialogue_override.B) dialogueB = dialogue_override.B;
    if (dialogue_override.killer) {
      killerWord = dialogue_override.killer;
    } else {
      // Derive killer word from last word of the final speaker
      const lastLine = (dialogueB || dialogueA || '');
      killerWord = lastLine.split(/\s+/).pop()?.replace(/[^\u0430-\u044f\u0451a-z]/gi, '') || killerWord;
    }
  }

  // ── Estimate duration ──
  const lines = soloMode
    ? [{ speaker: 'A', text: dialogueA, pace: charA.speech_pace }]
    : [
        { speaker: 'A', text: dialogueA, pace: charA.speech_pace },
        { speaker: 'B', text: dialogueB, pace: charB.speech_pace },
      ];

  let estimate = estimateDialogue(lines, { enforce8s: options.enforce8s !== false });
  let autoFixes = [];

  // VIDEO/SCRIPT mode: NEVER auto-trim — dialogue must be preserved verbatim from original
  // Only warn if it's too long, but don't modify
  const isPreserveMode = (input_mode === 'video' || input_mode === 'script');

  if (!isPreserveMode && options.allowAutoTrim && estimate.risk === 'high') {
    const trimResult = autoTrim(lines, {});
    if (trimResult.trimmed) {
      dialogueA = trimResult.lines[0]?.text || dialogueA;
      dialogueB = trimResult.lines[1]?.text || dialogueB;
      autoFixes = trimResult.auto_fixes;
      estimate = trimResult.estimate;
    }
  }

  // Warn user if dialogue is long in video/script mode (but DON'T modify it)
  if (isPreserveMode && estimate.risk === 'high') {
    warnings.push('⚠️ Диалог длиннее обычного — может не влезть в 8 секунд. Попробуйте сократить реплики в редакторе после генерации.');
  }

  // ── Safety: scan banned words — SKIP for video mode (preserve original verbatim) ──
  if (!isPreserveMode) {
    const safeA = scanBannedWords(dialogueA || '');
    const safeB = scanBannedWords(dialogueB || '');
    dialogueA = safeA.text;
    dialogueB = safeB.text;
    if (safeA.fixes.length) autoFixes.push(...safeA.fixes);
    if (safeB.fixes.length) autoFixes.push(...safeB.fixes);
  }

  // ── STRICT: Strip dashes/hyphens from speech ──
  // Dashes (—, –, -) are unpronounceable and cause TTS/Veo artifacts.
  // Only pipe | is allowed as pause marker.
  // SKIP for video mode — preserve original dialogue formatting
  if (!isPreserveMode) {
    const stripDashes = (text) => {
      let cleaned = text
        .replace(/\s*[—–]\s*/g, ' ')   // em-dash, en-dash → space
        .replace(/\s+-\s+/g, ' ')       // standalone hyphens (with spaces) → space
        .replace(/\s{2,}/g, ' ')        // collapse double spaces
        .trim();
      return cleaned;
    };
    const cleanA = stripDashes(dialogueA || '');
    const cleanB = stripDashes(dialogueB || '');
    if (cleanA !== dialogueA) { autoFixes.push('Убраны тире из реплики A (непроизносимые символы)'); dialogueA = cleanA; }
    if (cleanB !== dialogueB) { autoFixes.push('Убраны тире из реплики B (непроизносимые символы)'); dialogueB = cleanB; }
  }

  // ── Build all blocks ──
  const cast = buildCastContract(charA, charB);
  const cameraPreset = buildCameraPreset();
  const timingGrid = buildTimingGridV2(mergedHookObj, releaseObj);
  const cinematography = buildCinematography(lightingMood, location, wardrobeA, wardrobeB, charA, charB, mergedHookObj, releaseObj, propAnchor);
  const aesthetic = _aestheticToEn(charA.world_aesthetic || charB.world_aesthetic || 'VIP-деревенский уют');
  const nameEnA = charA.name_en || charA.id || 'Character A';
  const nameEnB = charB.name_en || charB.id || 'Character B';
  const vibeEnA = _vibeToEn(charA.vibe_archetype, 'provocateur');
  const vibeEnB = _vibeToEn(charB.vibe_archetype, 'grounded responder');

  // ── Location-specific overrides from catalog ──
  const locAudioHints = locationObj?.audio_hints || null;
  const locLighting = locationObj?.lighting || null;

  // ── PHOTO PROMPT (EN) ──
  const anchorA = charA.identity_anchors || {};
  const anchorB = charB.identity_anchors || {};

  const photo_prompt_en_json = {
    scene: soloMode
      ? `Smartphone medium shot photo capturing the EXACT HOOK MOMENT (frame 0, 0.0-0.7s) — the first frame from which the video will begin. Waist-up framing, device INVISIBLE. ${mergedHookObj.action_en.split(',').slice(0, 2).join(',').trim()} is ALREADY IN PROGRESS. Single character delivering a passionate comedic monologue directly to camera.${topicForScene} ${location}. ${lightingMood.style}. ${aesthetic} aesthetic. Mood: ${lightingMood.mood}. Shot on smartphone front camera, portrait mode, 9:16 vertical, 1080x1920px. Character is mid-hook-action with intense direct eye contact at camera lens. The video will be generated FROM this photo.${product_info?.description_en ? ` Character is holding a product in one hand — the product must appear EXACTLY as on the original reference photo: ${product_info.description_en.slice(0, 200)}.` : ` Character holds ${propAnchor} in one hand — clearly visible in frame, not blurred into background.`}`
      : `Smartphone medium shot photo capturing the EXACT HOOK MOMENT (frame 0, 0.0-0.7s) — the first frame from which the video will begin. Waist-up framing, device INVISIBLE. ${mergedHookObj.action_en.split(',').slice(0, 2).join(',').trim()} is ALREADY IN PROGRESS. Two characters in heated comedic confrontation.${topicForScene} ${location}. ${lightingMood.style}. ${aesthetic} aesthetic. Mood: ${lightingMood.mood}. Shot on smartphone front camera, portrait mode, 9:16 vertical, 1080x1920px. Character A is mid-hook-action with intense direct eye contact at camera lens. Character B is silent, mouth sealed, eyes tracking A with loaded reaction. The video will be generated FROM this photo — poses, expressions, and energy must be the exact starting point for animation.${product_info?.description_en ? ` Character A is holding a product in one hand — the product must appear EXACTLY as on the original reference photo: ${product_info.description_en.slice(0, 200)}.` : ` Character A holds ${propAnchor} in one hand — clearly visible in frame, not blurred into background.`}`,
    ...(topicEn ? { topic_context: topicEn } : {}),
    IDENTITY_LOCK: 'CRITICAL: This photo is the CHARACTER VISUAL ANCHOR. The video will be generated FROM this exact image (frame 0). Every biological detail (skin tone, wrinkles, scars, facial hair, eye color, nose shape, jaw, teeth), every accessory (glasses, earrings, headwear, jewelry), and every wardrobe detail (fabric, pattern, color palette) MUST appear EXACTLY as described below. If a character has gold teeth — gold teeth MUST be visible. If they wear a headscarf — it MUST be in frame. If they have a scar — render it. Deviation = broken identity across all videos. Generate this photo ONCE per character pair and reuse it as the image input for EVERY video with these characters.',
    characters: soloMode ? [
      {
        role: 'Solo performer (speaking)',
        appearance: charA.prompt_tokens?.character_en || cast.speaker_A.character_en,
        face_anchor: anchorA.face_silhouette || 'distinctive face',
        signature: anchorA.signature_element || 'notable accessory',
        skin_detail: cast.speaker_A.skin,
        eyes_detail: cast.speaker_A.eyes,
        hair_detail: safeArr(charA.biology_override?.hair_tokens) || 'distinctive hair',
        nose_detail: safeArr(charA.biology_override?.nose_tokens) || 'natural nose',
        build_detail: charA.biology_override?.height_build || 'medium build',
        mouth_detail: `mouth open mid-word, ${safeArr(charA.biology_override?.mouth_tokens) || 'realistic teeth/gums'}, ${safeArr(charA.biology_override?.teeth_tokens) || 'natural teeth'}, ${safeArr(charA.biology_override?.lip_texture_tokens) || 'lip moisture'}, micro saliva glint on lower lip`,
        jaw_detail: safeArr(charA.biology_override?.jaw_tokens) || undefined,
        chin_detail: safeArr(charA.biology_override?.chin_tokens) || undefined,
        cheekbone_detail: safeArr(charA.biology_override?.cheekbone_tokens) || undefined,
        forehead_detail: safeArr(charA.biology_override?.forehead_tokens) || undefined,
        eyebrow_detail: safeArr(charA.biology_override?.eyebrow_tokens) || undefined,
        undereye_detail: safeArr(charA.biology_override?.undereye_tokens) || undefined,
        ear_detail: safeArr(charA.biology_override?.ear_tokens) || undefined,
        neck_detail: safeArr(charA.biology_override?.neck_tokens) || undefined,
        expression: `mid-sentence ${charA.speech_pace === 'fast' ? 'animated, rapid gesticulation, eyes wide with righteous energy' : charA.speech_pace === 'slow' ? 'intense, measured fury, narrowed eyes burning with controlled outrage' : 'passionate, eyebrows raised in indignation'}, ${anchorA.micro_gesture || 'expressive gesture'}, direct intense eye contact with lens, nostrils slightly flared`,
        body: `${charA.compatibility === 'chaotic' ? 'leaning forward aggressively, both hands gesturing wildly, shoulders tense, invading camera space' : charA.compatibility === 'calm' ? 'upright posture with one hand gesturing precisely, controlled power stance, finger pointing for emphasis' : 'leaning forward, one hand gesturing emphatically (fingers naturally curled, anatomically correct), shoulders tense and raised'}`,
        // ── FULL BIOLOGY IDENTITY (photo anchor) ──
        skin_color: safeArr(charA.biology_override?.skin_color_tokens) || undefined,
        wrinkle_map: safeArr(charA.biology_override?.wrinkle_map_tokens) || undefined,
        nasolabial: safeArr(charA.biology_override?.nasolabial_tokens) || undefined,
        body_shape: safeArr(charA.biology_override?.body_shape_tokens) || undefined,
        posture: safeArr(charA.biology_override?.posture_tokens) || undefined,
        shoulders: safeArr(charA.biology_override?.shoulder_tokens) || undefined,
        hands: safeArr(charA.biology_override?.hands_tokens) || undefined,
        scar_marks: safeArr(charA.biology_override?.scar_mark_tokens) || undefined,
        facial_hair: safeArr(charA.biology_override?.facial_hair_tokens) && !/^none$/i.test(safeArr(charA.biology_override?.facial_hair_tokens)) ? safeArr(charA.biology_override?.facial_hair_tokens) : undefined,
        eyelashes: safeArr(charA.biology_override?.eyelash_tokens) || undefined,
        resting_face: charA.biology_override?.facial_expression_default || undefined,
        // ── V19.3 REALISM PHYSICS ──
        skin_glow: safeArr(charA.biology_override?.skin_glow_tokens) || undefined,
        eye_catchlight: safeArr(charA.biology_override?.eye_catchlight_tokens) || undefined,
        lip_finish: safeArr(charA.biology_override?.lip_finish_tokens) || undefined,
        // ── WARDROBE IDENTITY ANCHORS ──
        wardrobe: wardrobeA,
        wardrobe_anchor: anchorA.wardrobe_anchor || undefined,
        accessories: safeArr(anchorA.accessory_anchors) || undefined,
        glasses: anchorA.glasses_anchor && anchorA.glasses_anchor !== 'none' ? anchorA.glasses_anchor : undefined,
        headwear: anchorA.headwear_anchor && anchorA.headwear_anchor !== 'none' ? anchorA.headwear_anchor : undefined,
        jewelry: anchorA.jewelry_anchors && anchorA.jewelry_anchors !== 'none' ? anchorA.jewelry_anchors : undefined,
        color_palette: safeArr(anchorA.color_palette) || undefined,
        fabric_texture: anchorA.fabric_texture_anchor || undefined,
        pattern: anchorA.pattern_anchor && anchorA.pattern_anchor !== 'solid color' ? anchorA.pattern_anchor : undefined,
        sleeve_style: anchorA.sleeve_style_anchor || undefined,
        spatial: 'centered in frame, facing camera directly',
      },
    ] : [
      {
        role: 'A — provocateur (speaking)',
        appearance: charA.prompt_tokens?.character_en || cast.speaker_A.character_en,
        face_anchor: anchorA.face_silhouette || 'distinctive face',
        signature: anchorA.signature_element || 'notable accessory',
        skin_detail: cast.speaker_A.skin,
        eyes_detail: cast.speaker_A.eyes,
        hair_detail: safeArr(charA.biology_override?.hair_tokens) || 'distinctive hair',
        nose_detail: safeArr(charA.biology_override?.nose_tokens) || 'natural nose',
        build_detail: charA.biology_override?.height_build || 'medium build',
        mouth_detail: `mouth open mid-word, ${safeArr(charA.biology_override?.mouth_tokens) || 'realistic teeth/gums'}, ${safeArr(charA.biology_override?.teeth_tokens) || 'natural teeth'}, ${safeArr(charA.biology_override?.lip_texture_tokens) || 'lip moisture'}, micro saliva glint on lower lip`,
        jaw_detail: safeArr(charA.biology_override?.jaw_tokens) || undefined,
        chin_detail: safeArr(charA.biology_override?.chin_tokens) || undefined,
        cheekbone_detail: safeArr(charA.biology_override?.cheekbone_tokens) || undefined,
        forehead_detail: safeArr(charA.biology_override?.forehead_tokens) || undefined,
        eyebrow_detail: safeArr(charA.biology_override?.eyebrow_tokens) || undefined,
        undereye_detail: safeArr(charA.biology_override?.undereye_tokens) || undefined,
        ear_detail: safeArr(charA.biology_override?.ear_tokens) || undefined,
        neck_detail: safeArr(charA.biology_override?.neck_tokens) || undefined,
        expression: `mid-sentence ${charA.speech_pace === 'fast' ? 'animated, rapid gesticulation, eyes wide with righteous energy' : charA.speech_pace === 'slow' ? 'intense, measured fury, narrowed eyes burning with controlled outrage' : 'passionate, eyebrows raised in indignation'}, ${anchorA.micro_gesture || 'expressive gesture'}, direct intense eye contact with lens, nostrils slightly flared`,
        body: `${charA.compatibility === 'chaotic' ? 'leaning forward aggressively, both hands gesturing wildly, shoulders tense, invading camera space' : charA.compatibility === 'calm' ? 'upright posture with one hand gesturing precisely, controlled power stance, finger pointing for emphasis' : 'leaning forward, one hand gesturing emphatically (fingers naturally curled, anatomically correct), shoulders tense and raised'}`,
        // ── FULL BIOLOGY IDENTITY (photo anchor) ──
        skin_color: safeArr(charA.biology_override?.skin_color_tokens) || undefined,
        wrinkle_map: safeArr(charA.biology_override?.wrinkle_map_tokens) || undefined,
        nasolabial: safeArr(charA.biology_override?.nasolabial_tokens) || undefined,
        body_shape: safeArr(charA.biology_override?.body_shape_tokens) || undefined,
        posture: safeArr(charA.biology_override?.posture_tokens) || undefined,
        shoulders: safeArr(charA.biology_override?.shoulder_tokens) || undefined,
        hands: safeArr(charA.biology_override?.hands_tokens) || undefined,
        scar_marks: safeArr(charA.biology_override?.scar_mark_tokens) || undefined,
        facial_hair: safeArr(charA.biology_override?.facial_hair_tokens) && !/^none$/i.test(safeArr(charA.biology_override?.facial_hair_tokens)) ? safeArr(charA.biology_override?.facial_hair_tokens) : undefined,
        eyelashes: safeArr(charA.biology_override?.eyelash_tokens) || undefined,
        resting_face: charA.biology_override?.facial_expression_default || undefined,
        // ── V19.3 REALISM PHYSICS ──
        skin_glow: safeArr(charA.biology_override?.skin_glow_tokens) || undefined,
        eye_catchlight: safeArr(charA.biology_override?.eye_catchlight_tokens) || undefined,
        lip_finish: safeArr(charA.biology_override?.lip_finish_tokens) || undefined,
        // ── WARDROBE IDENTITY ANCHORS ──
        wardrobe: wardrobeA,
        wardrobe_anchor: anchorA.wardrobe_anchor || undefined,
        accessories: safeArr(anchorA.accessory_anchors) || undefined,
        glasses: anchorA.glasses_anchor && anchorA.glasses_anchor !== 'none' ? anchorA.glasses_anchor : undefined,
        headwear: anchorA.headwear_anchor && anchorA.headwear_anchor !== 'none' ? anchorA.headwear_anchor : undefined,
        jewelry: anchorA.jewelry_anchors && anchorA.jewelry_anchors !== 'none' ? anchorA.jewelry_anchors : undefined,
        color_palette: safeArr(anchorA.color_palette) || undefined,
        fabric_texture: anchorA.fabric_texture_anchor || undefined,
        pattern: anchorA.pattern_anchor && anchorA.pattern_anchor !== 'solid color' ? anchorA.pattern_anchor : undefined,
        sleeve_style: anchorA.sleeve_style_anchor || undefined,
        spatial: 'positioned left of frame, body angled 30° toward B',
      },
      {
        role: 'B — punchline (listening, silent)',
        appearance: charB.prompt_tokens?.character_en || cast.speaker_B.character_en,
        face_anchor: anchorB.face_silhouette || 'distinctive face',
        signature: anchorB.signature_element || 'notable accessory',
        skin_detail: cast.speaker_B.skin,
        eyes_detail: cast.speaker_B.eyes,
        hair_detail: safeArr(charB.biology_override?.hair_tokens) || 'distinctive hair',
        nose_detail: safeArr(charB.biology_override?.nose_tokens) || 'natural nose',
        build_detail: charB.biology_override?.height_build || 'medium build',
        mouth_detail: `mouth FIRMLY SEALED, ${safeArr(charB.biology_override?.mouth_tokens) || 'jaw still'}, ${safeArr(charB.biology_override?.teeth_tokens) || 'teeth hidden'}, ${safeArr(charB.biology_override?.lip_texture_tokens) || 'lips pressed together'}, slight contemptuous curl at corner`,
        jaw_detail: safeArr(charB.biology_override?.jaw_tokens) || undefined,
        chin_detail: safeArr(charB.biology_override?.chin_tokens) || undefined,
        cheekbone_detail: safeArr(charB.biology_override?.cheekbone_tokens) || undefined,
        forehead_detail: safeArr(charB.biology_override?.forehead_tokens) || undefined,
        eyebrow_detail: safeArr(charB.biology_override?.eyebrow_tokens) || undefined,
        undereye_detail: safeArr(charB.biology_override?.undereye_tokens) || undefined,
        ear_detail: safeArr(charB.biology_override?.ear_tokens) || undefined,
        neck_detail: safeArr(charB.biology_override?.neck_tokens) || undefined,
        expression: `${charB.compatibility === 'calm' ? 'zen-like stillness, barely contained superiority' : charB.compatibility === 'chaotic' ? 'simmering barely-restrained energy, jaw tight, eyes burning' : charB.compatibility === 'conflict' ? 'cold calculating stare, measuring every word A says' : 'amused skepticism, one corner of mouth fighting a smirk'}, ${anchorB.micro_gesture || 'raised eyebrow'}, eyes tracking A with ${charB.speech_pace === 'slow' ? 'patient devastating certainty' : 'sharp analytical intensity'}, one eyebrow 2mm higher than the other`,
        body: `${charB.compatibility === 'calm' ? 'perfectly still, arms loosely crossed, weight centered, radiating quiet authority' : charB.compatibility === 'chaotic' ? 'restless energy contained in stillness, fingers tapping on crossed arms, weight shifting' : 'arms crossed or hands on hips, leaning back slightly, weight on back foot, chin slightly raised'}`,
        // ── FULL BIOLOGY IDENTITY (photo anchor) ──
        skin_color: safeArr(charB.biology_override?.skin_color_tokens) || undefined,
        wrinkle_map: safeArr(charB.biology_override?.wrinkle_map_tokens) || undefined,
        nasolabial: safeArr(charB.biology_override?.nasolabial_tokens) || undefined,
        body_shape: safeArr(charB.biology_override?.body_shape_tokens) || undefined,
        posture: safeArr(charB.biology_override?.posture_tokens) || undefined,
        shoulders: safeArr(charB.biology_override?.shoulder_tokens) || undefined,
        hands: safeArr(charB.biology_override?.hands_tokens) || undefined,
        scar_marks: safeArr(charB.biology_override?.scar_mark_tokens) || undefined,
        facial_hair: safeArr(charB.biology_override?.facial_hair_tokens) && !/^none$/i.test(safeArr(charB.biology_override?.facial_hair_tokens)) ? safeArr(charB.biology_override?.facial_hair_tokens) : undefined,
        eyelashes: safeArr(charB.biology_override?.eyelash_tokens) || undefined,
        resting_face: charB.biology_override?.facial_expression_default || undefined,
        // ── V19.3 REALISM PHYSICS ──
        skin_glow: safeArr(charB.biology_override?.skin_glow_tokens) || undefined,
        eye_catchlight: safeArr(charB.biology_override?.eye_catchlight_tokens) || undefined,
        lip_finish: safeArr(charB.biology_override?.lip_finish_tokens) || undefined,
        // ── WARDROBE IDENTITY ANCHORS ──
        wardrobe: wardrobeB,
        wardrobe_anchor: anchorB.wardrobe_anchor || undefined,
        accessories: safeArr(anchorB.accessory_anchors) || undefined,
        glasses: anchorB.glasses_anchor && anchorB.glasses_anchor !== 'none' ? anchorB.glasses_anchor : undefined,
        headwear: anchorB.headwear_anchor && anchorB.headwear_anchor !== 'none' ? anchorB.headwear_anchor : undefined,
        jewelry: anchorB.jewelry_anchors && anchorB.jewelry_anchors !== 'none' ? anchorB.jewelry_anchors : undefined,
        color_palette: safeArr(anchorB.color_palette) || undefined,
        fabric_texture: anchorB.fabric_texture_anchor || undefined,
        pattern: anchorB.pattern_anchor && anchorB.pattern_anchor !== 'solid color' ? anchorB.pattern_anchor : undefined,
        sleeve_style: anchorB.sleeve_style_anchor || undefined,
        spatial: 'positioned right of frame, body angled 30° toward A',
      },
    ],
    environment: {
      location,
      lighting: `${locLighting || lightingMood.style}`,
      lighting_sources: lightingMood.sources || '1 dominant environmental + 1 ambient fill bounce',
      lighting_direction: lightingMood.direction || 'Key from environment, fill from nearest reflective surface',
      shadow_quality: lightingMood.shadow_softness || 'Soft but present shadows under nose and cheekbones',
      overexposure: lightingMood.overexposure_budget || 'Allow +0.5 EV on skin highlights — natural smartphone sensor clipping',
      color_temperature: lightingMood.color_temp || 'Locked to dominant source color temperature',
      lighting_mood: lightingMood.mood,
      prop_anchor: `${propAnchor} visible in mid-ground, in computational bokeh blur (recognizable shape, soft edges)`,
      props: ['worn textured surface beneath characters', propAnchor, '1-2 ambient domestic details in deep bokeh background'],
      atmosphere: `lived-in, authentic, slightly chaotic. NOT a set — a real place where people actually live/work. Category vibe: ${cat.en.toLowerCase()}`,
    },
    camera: {
      device: 'Smartphone front camera (24-28mm equiv, f/1.9-2.2, small sensor). This is NOT a DSLR or cinema camera.',
      angle: 'slightly below eye level (5-10°), selfie POV at arm\'s length (35-55cm), phone INVISIBLE, holder\'s arm NOT in frame',
      distance: '35-55cm from lens to nearest face. Close enough to resolve individual pores, skin texture, iris detail. Both faces fill 60-70% of vertical 9:16 frame.',
      lens: '24-28mm equivalent (front camera native). Slight barrel distortion at frame edges — this is CORRECT. Faces at center relatively undistorted. Computational portrait-mode bokeh on background.',
      focus: 'Phone face-tracking AF: both faces sharp (same focal plane at selfie distance). Background separates via computational blur — smooth gaussian, NOT cinema hexagonal bokeh.',
      composition: 'Natural selfie framing: A left third, B right third. 5-8% headroom. Characters slightly below center (arm holds phone slightly above eye level). Intimate, not perfectly composed.',
      sensor_artifacts: 'Visible luminance noise in shadow areas (ISO 400-1600). Slight JPEG compression (quality 85-92%). Limited dynamic range — highlights may clip +0.5-1.5 EV on bright skin. Mild purple fringing on backlit edges. Faint rolling-shutter lean if any motion blur.',
      realism_anchors: 'handheld micro-jitter frozen as slight motion blur on fast gestures, imperfect auto white-balance (±200K drift toward warm), realistic nose/cheekbone shadows from single environmental light source, slight sensor noise in dark clothing/shadows, natural vignetting in corners (-0.3 EV)',
    },
    color_mood: lightingMood.mood === 'nostalgic warmth'
      ? 'warm amber undertone, golden highlights, slightly desaturated shadows, natural skin tones, subtle teal in shadows for cinematic contrast'
      : lightingMood.mood === 'sterile tension'
      ? 'cool desaturated palette, greenish midtones from fluorescent, pale skin rendering, muted colors, clinical contrast'
      : lightingMood.mood === 'organic chaos'
      ? 'dappled warm-cool mix, green-gold foliage reflections on skin, natural vibrant saturation, earthy tones'
      : lightingMood.mood === 'dramatic intimacy'
      ? 'high-contrast chiaroscuro, deep amber in highlights, rich black shadows, warm skin tones with cool shadow edges'
      : lightingMood.mood === 'golden confrontation'
      ? 'split warm/cool: gold highlights on sun side (2800K), blue-tinted shadows on shade side (5500K), skin glows warm, rich contrast'
      : lightingMood.mood === 'domestic tension'
      ? 'dual-tone: warm overhead amber + cool blue TV-bounce side-fill, face split between warm and cool, moody domestic ambiance'
      : lightingMood.mood === 'exposed clarity'
      ? 'bright even daylight, minimal color cast, accurate skin tones, clean and honest look, slight warmth from ground bounce'
      : 'soft neutral palette, slight blue undertone, gentle contrast, natural skin tones with minimal color cast',
    hands_instruction: 'CRITICAL: All hands must have exactly 5 fingers, anatomically correct proportions, natural nail detail, age-appropriate skin texture on hands matching face',
    style: `Smartphone selfie photograph — NOT studio, NOT DSLR, NOT film. Small-sensor look with computational photography processing. Visible noise in shadows (ISO 800-1600), slight JPEG artifacts, imperfect auto-WB. Skin pores, ${parseInt(String(charA.biology_override?.age || '').replace(/[^0-9]/g, ''), 10) < 35 ? 'natural skin texture, minor imperfections' : 'wrinkles, age marks'}, oily sheen VISIBLE and CELEBRATED. This is FRAME 0 of the video — the exact starting point. The video will be generated FROM this image via image-to-video AI. Poses and expressions must be the natural starting position for the 8-second video that follows.`,
    negative: [
      'no text overlay, no subtitles, no captions, no letters, no numbers on image, no frames, no borders, no REC badge, no timestamp, no timecode, no watermark, no logo, no UI elements, no graphic overlays, no title cards, no speech bubbles, no name tags, no phone/camera visible in frame, no cartoon, no anime, no plastic/airbrushed skin, no 6th finger, no extra limbs, no symmetrical twins, no stock photo feel, no studio lighting, no ring light catch-lights, no cinema bokeh (hexagonal), no DSLR shallow-DOF look, no beauty mode, no skin smoothing filter, no HDR tone-mapping artifacts, no perfectly even lighting, no orange spray-tan skin, no grey lifeless face',
      ...(charA.negative_hint_tokens || []).map(t => `Character A: ${t}`),
      ...(!soloMode ? (charB.negative_hint_tokens || []).map(t => `Character B: ${t}`) : []),
    ].join(', '),
    ...(product_info?.description_en ? {
      product_placement: {
        instruction: 'CRITICAL: One character MUST be holding or interacting with the product described below. The product must appear EXACTLY as on the ORIGINAL REFERENCE PHOTO — same shape, colors, branding, materials, proportions, textures, reflections. This is a REAL product that exists — render it with photorealistic fidelity. If the reference photo shows a red bottle with gold cap, the AI output must show the EXACT same red bottle with gold cap. Zero creative liberties with the product appearance.',
        product_description: product_info.description_en,
        placement: 'Character A holds the product in their hand while arguing. Product clearly visible in frame center-left, sharp focus. Product occupies 10-15% of frame area. Photorealistic rendering — every label, color, texture must match the uploaded reference photo exactly.',
        lighting_on_product: 'Same environmental lighting as scene. Natural specular highlights on product surface consistent with the light source direction described above. No studio product lighting.',
      }
    } : {}),
    ...(reference_style?.description_en ? {
      visual_reference: {
        instruction: 'Match the visual aesthetic described below as closely as possible — lighting direction, color palette, mood, contrast, composition style. Keep the characters, selfie format, and dialogue intact.',
        style_description: reference_style.description_en,
      }
    } : {}),
  };

  // ── VIDEO PROMPT (EN) ──
  const video_prompt_en_json = {
    cast,
    identity_anchors: {
      A: { silhouette: anchorA.face_silhouette, element: anchorA.signature_element, gesture: anchorA.micro_gesture, wardrobe: wardrobeA, glasses: anchorA.glasses_anchor && anchorA.glasses_anchor !== 'none' ? anchorA.glasses_anchor : undefined, headwear: anchorA.headwear_anchor && anchorA.headwear_anchor !== 'none' ? anchorA.headwear_anchor : undefined, jewelry: anchorA.jewelry_anchors && anchorA.jewelry_anchors !== 'none' ? anchorA.jewelry_anchors : undefined, accessories: safeArr(anchorA.accessory_anchors) || undefined },
      B: { silhouette: anchorB.face_silhouette, element: anchorB.signature_element, gesture: anchorB.micro_gesture, wardrobe: wardrobeB, glasses: anchorB.glasses_anchor && anchorB.glasses_anchor !== 'none' ? anchorB.glasses_anchor : undefined, headwear: anchorB.headwear_anchor && anchorB.headwear_anchor !== 'none' ? anchorB.headwear_anchor : undefined, jewelry: anchorB.jewelry_anchors && anchorB.jewelry_anchors !== 'none' ? anchorB.jewelry_anchors : undefined, accessories: safeArr(anchorB.accessory_anchors) || undefined },
      serial: { aesthetic, prop_anchor: propAnchor },
    },
    ...(topicEn ? { topic_context: topicEn } : {}),
    ...(sceneHint ? { scene_reference: `Visual/structural reference from source video: "${sceneHint}". Adapt the energy and pacing but keep original characters and dialogue.` } : {}),
    dialogue: {
      CRITICAL_INSTRUCTION: input_mode === 'script'
        ? 'The user provided their OWN dialogue below. AI engine MUST USE the user\'s lines as-is (dialogue_A_ru / dialogue_B_ru). You may ONLY adjust 1-2 words for timing fit. Do NOT rewrite or replace the user\'s script. Generate killer_word from the last impactful word of B\'s line.'
        : input_mode === 'video'
        ? 'This is REMAKE MODE — the dialogue below is from the ORIGINAL VIDEO. AI engine MUST preserve it VERBATIM (90-95% of words). Only change character names/pronouns to fit our cast. Do NOT invent a new dialogue. killer_word = last impactful word from B\'s original line.'
        : 'AI engine MUST invent its OWN dialogue from scratch. The example below is ONLY to show format and style. NEVER copy or reuse the example lines. Generate completely original, funny, contextually perfect dialogue for THESE specific characters and THIS category.',
      example_format_only: {
        example_A_ru: dialogueA,
        example_B_ru: dialogueB,
        example_killer_word: killerWord,
        note: 'THIS IS JUST A FORMAT EXAMPLE. You MUST write your own lines that are funnier and more fitting for the characters above.',
      },
      language: 'CRITICAL: All dialogue MUST be spoken in Russian (русский язык). Characters speak naturally with authentic Russian intonation, regional accent variations, and age-appropriate speech patterns. NO English speech allowed.',
      speech_style_A: _speechStyleToEn(charA.speech_style_ru, charA.speech_pace, charA.compatibility),
      speech_style_B: _speechStyleToEn(charB.speech_style_ru, charB.speech_pace, charB.compatibility),
      lip_sync: 'CRITICAL: mouth movements must match Russian phonemes precisely. Each syllable produces visible jaw/lip movement. Consonants: visible tongue/teeth contact. Vowels: proportional mouth opening.',
      delivery_A: `${charA.speech_pace} pace, ${vibeEnA} energy, ${charA.swear_level > 1 ? 'occasional expressive profanity as accent' : 'controlled passionate delivery'}`,
      voice_timbre_A: safeArr(charA.biology_override?.voice_texture_tokens) || `${charA.speech_pace === 'fast' ? 'high-energy, slightly shrill when agitated, voice cracks on emphasis words' : charA.speech_pace === 'slow' ? 'deep gravelly rasp, deliberate enunciation, resonant chest voice' : 'mid-range natural voice, rises in pitch with indignation'}. Age-appropriate ${cast.speaker_A.age} voice`,
      delivery_B: `${charB.speech_pace} pace, ${vibeEnB} energy, measured buildup to killer word, voice drops for contrast`,
      voice_timbre_B: safeArr(charB.biology_override?.voice_texture_tokens) || `${charB.speech_pace === 'slow' ? 'low deliberate rumble, pauses filled with audible nose-exhale, words land like stones' : charB.speech_pace === 'fast' ? 'sharp staccato delivery, clipped consonants, rapid-fire with sudden stops for effect' : 'steady measured mid-tone, controlled volume that drops to near-whisper on killer word for devastating contrast'}. Age-appropriate ${cast.speaker_B.age} voice`,
    },
    spatial: {
      positioning: 'Both characters face camera at arm\'s length distance (selfie POV). A on left, B on right. They stand/sit shoulder-to-shoulder or slightly angled toward each other (30°). Close enough to touch but not touching.',
      camera_movement: 'Handheld micro-jitter throughout. Hook: slight camera push-in. Act_A: subtle drift toward A. Act_B: micro-pan to B. Release: camera shakes from laughter tremor.',
      environment_interaction: `Characters naturally inhabit ${location.split(',')[0]}. Ambient environment detail reinforces ${cat.en.toLowerCase()} theme.`,
    },
    emotion_arc: {
      hook: `tension spike — ${mergedHookObj.action_en}, ${vibeEnA} initiates with signature energy`,
      act_A: `escalation — ${nameEnA} (A) builds ${charA.speech_pace === 'fast' ? 'rapid-fire righteous indignation, words tumbling out' : charA.speech_pace === 'slow' ? 'deliberate simmering outrage, each word weighted' : 'rising passionate indignation'}. ${nameEnB} (B) simmers: ${charB.modifiers?.laugh_style === 'grudging smirk' ? 'jaw locked, one eyebrow rising in disbelief' : 'stone-faced, micro-reactions in eyes only'}`,
      act_B: `reversal — ${nameEnB} (B) delivers ${charB.speech_pace === 'slow' ? 'devastatingly measured response, pauses as weapons' : charB.speech_pace === 'fast' ? 'rapid comeback that builds to the kill shot' : 'controlled response building to killer word'}. "${killerWord}" lands with visible physical impact on ${nameEnA} (A). ${nameEnA} freezes mid-gesture.`,
      release: enableLaughter
        ? `catharsis — ${releaseObj.action_en}. Tension dissolves into warmth. ${charA.modifiers?.laugh_style || 'genuine laughter'} from A, ${charB.modifiers?.laugh_style || 'satisfied chuckle'} from B.`
        : `cold ending — stunned silence after punchline "${killerWord}". No laughter. Frozen expressions, tension holds. Rewatch-bait: ambiguous micro-expression in last 0.3s.`,
    },
    vibe: {
      dynamic: `${nameEnA} (A, ${vibeEnA}) → ${nameEnB} (B, ${vibeEnB})`,
      hook: mergedHookObj.action_en,
      conflict: `Comedic tension about ${cat.en.toLowerCase()}${topicRu ? ' (see topic_context above for details)' : ''}, no personal insults, rage directed at situation only`,
      punchline: `Killer word "${killerWord}" lands near 6.8s mark, followed by ${releaseObj.action_en}`,
      tone: `${charA.compatibility === 'chaotic' || charB.compatibility === 'chaotic' ? 'Explosive chaotic energy — physical comedy, big gestures, near-slapstick' : charA.compatibility === 'calm' || charB.compatibility === 'calm' ? 'Slow-burn tension — understated delivery, power in restraint, devastating quiet punchline' : 'Balanced push-pull — both characters committed, natural escalation to punchline'}`,
    },
    camera: cameraPreset,
    cinematography,
    world: {
      location,
      lighting: `${locLighting || lightingMood.style}, no studio lighting`,
      lighting_mood: lightingMood.mood,
      wardrobe_A: wardrobeA,
      wardrobe_B: wardrobeB,
      prop_anchor: `${propAnchor} — visible in scene, may be interacted with during hook`,
    },
    timing: timingGrid,
    audio: {
      room_tone: locAudioHints
        || (location.includes('kitchen') || location.includes('fridge')
        ? 'humming Saratov fridge compressor cycle, wall clock tick, distant plumbing gurgle, occasional window draft whistle'
        : location.includes('garden') || location.includes('greenhouse') || location.includes('sunflower')
        ? 'bird song (sparrows, distant cuckoo), wind through foliage, buzzing insects, soil crunch underfoot'
        : location.includes('balcony') || location.includes('laundry')
        ? 'distant city hum, car horns at irregular intervals, pigeon cooing, clothesline wire creak in wind'
        : location.includes('stairwell') || location.includes('mailbox')
        ? 'fluorescent tube buzz, distant elevator machinery, muffled TV through walls, echo in concrete space'
        : location.includes('bazaar') || location.includes('watermelon')
        ? 'crowd murmur, vendor calls, plastic bag rustle, metal scale clank, distant radio music'
        : location.includes('polyclinic') || location.includes('mint-green')
        ? 'fluorescent hum, rubber shoe squeaks on linoleum, distant intercom PA, muffled coughing behind doors'
        : location.includes('marshrutka') || location.includes('vinyl')
        ? 'diesel engine vibration, vinyl seat squeak, hanging air freshener sway, muffled traffic outside, door pneumatics hiss'
        : location.includes('barn') || location.includes('hay')
        ? 'creaking wood, wind through plank gaps, distant animal sounds, swinging lightbulb chain clink'
        : location.includes('attic') || location.includes('rafter')
        ? 'roof rain patter or wind howl, creaking rafters, moth flutter, dust settling whisper'
        : location.includes('garage')
        ? 'metal tool clink, oil drip echo, distant car engine, fluorescent tube buzz, radio static'
        : location.includes('elevator')
        ? 'motor hum, cable tension creak, distant floor ding, muffled voices through walls'
        : location.includes('bathroom')
        ? 'dripping tap, pipe gurgle, tile echo, extractor fan hum'
        : location.includes('bedroom')
        ? 'wall clock tick, muffled TV from neighbors, fabric rustle, radiator click'
        : location.includes('office')
        ? 'keyboard clicking, air conditioning hum, printer whirring, muffled phone ringing'
        : location.includes('store') || location.includes('shop')
        ? 'checkout beep, shopping cart rattle, muzak in background, plastic bag rustle'
        : location.includes('corridor') || location.includes('hallway')
        ? 'fluorescent buzz, distant footsteps echo, door closing somewhere, muffled voices'
        : 'subtle ambient room sound — quiet hum, occasional creak, authentic space acoustics matching location'),
      cloth_rustle: `on every major body movement: A wears ${wardrobeA.split(',')[0]} — ${wardrobeA.includes('silk') || wardrobeA.includes('chiffon') ? 'soft whisper swish' : wardrobeA.includes('leather') ? 'stiff leather creak' : wardrobeA.includes('knit') || wardrobeA.includes('mohair') || wardrobeA.includes('wool') ? 'soft fibrous drag' : 'medium fabric rustle'}; B wears ${wardrobeB.split(',')[0]} — ${wardrobeB.includes('telnyashka') || wardrobeB.includes('cotton') ? 'cotton stretch snap' : wardrobeB.includes('corduroy') ? 'corduroy ridge whisper' : wardrobeB.includes('quilted') || wardrobeB.includes('fufaika') ? 'padded fabric thump' : 'natural fabric rustle'}`,
      saliva_clicks: 'subtle mouth sounds on hard consonants (t, k, p, d — Russian plosives)',
      breathing: 'audible inhale before each speaking turn, exhale on emphasis words',
      overlap_policy: 'STRICTLY FORBIDDEN. Gap 0.15-0.25s silence stitch between speakers. No simultaneous speech ever.',
      mouth_rule: 'Non-speaking character: sealed lips, jaw completely still, NO micro-movements of mouth. Eye tracking and subtle facial micro-expressions ONLY.',
      laugh: enableLaughter ? 'louder than dialogue peak by 20-30%, no digital clipping, raspy and contagious, bodies visibly shaking' : 'NO LAUGHTER in this video. The scene ends in silence after the punchline. No giggling, no chuckling, no smirking sounds.',
      foley: 'table/surface impacts if hook involves slap, object rattle on impact, fabric whoosh on dramatic gesture',
    },
    safety: {
      banned_words_replaced: true,
      device_invisible: true,
      no_overlays: true,
      no_text_in_frame: true,
      content_type: 'satirical/domestic',
      hands: 'exactly 5 fingers per hand at all times, anatomically correct',
    },
    output: { format: 'mp4 h264', resolution: '1080x1920 vertical 9:16', fps: 30, duration: '8.0s ±0.2s', color: 'rec709, natural grade, no LUT' },
    ...(product_info?.description_en ? {
      product_placement: {
        instruction: 'CRITICAL: The product described below MUST appear in the video EXACTLY as on the ORIGINAL REFERENCE PHOTO. Same shape, colors, branding, materials, proportions, textures. Zero creative liberties with product appearance — it is a REAL product.',
        product_description: product_info.description_en,
        integration: 'Product is naturally woven into the comedic argument. Character A holds the product throughout their line — gestures with it, shows it to camera, uses it as a prop. Product remains visible during both acts A and B.',
        rendering: 'Photorealistic fidelity — every label, color gradient, texture, material must match the uploaded reference photo. Environmental lighting on product consistent with scene. No studio product lighting.',
      }
    } : {}),
    ...(reference_style?.description_en ? {
      visual_reference: {
        instruction: 'Match the visual aesthetic described below — lighting, color palette, mood, contrast, composition. Keep characters and dialogue intact.',
        style_description: reference_style.description_en,
      }
    } : {}),
  };

  // ── VEO 3.1 PROMPT (single text for Google Flow) ──
  const veo_prompt = buildVeoPrompt({
    charA, charB, cast, location, lightingMood, wardrobeA, wardrobeB,
    hookObj: mergedHookObj, releaseObj, propAnchor, dialogueA, dialogueB, killerWord,
    cat, topicRu, aesthetic, cinematography, isOutdoor, dialogueA2: null,
    productInfo: product_info,
    referenceStyle: reference_style,
    soloMode,
    enableLaughter,
  });

  // ── ENGAGEMENT (smart hashtags + viral bait) ──
  const engage = buildEngagement(cat.ru, charA, charB, rng, soloMode);

  // ── RU PACKAGE ──
  const hashMem = thread_memory ? (typeof btoa !== 'undefined' ? btoa(unescape(encodeURIComponent(thread_memory))).slice(0, 8) : 'mem') : 'none';
  // ── Pair/Solo dynamic label ──
  const pairDynamic = soloMode
    ? `🎭 Соло: ${charA.vibe_archetype || charA.compatibility}`
    : charA.compatibility === 'chaotic' && charB.compatibility === 'calm' ? '🔥 Взрывная пара: хаос vs спокойствие'
    : charA.compatibility === 'chaotic' || charB.compatibility === 'chaotic' ? '🌪 Хаотичная пара'
    : charA.compatibility === 'conflict' || charB.compatibility === 'conflict' ? '⚡ Конфликтная пара'
    : charA.compatibility === 'meme' && charB.compatibility === 'meme' ? '😂 Мем-пара'
    : '⚖️ Сбалансированная пара';

  const ru_package = soloMode ? `🎬 МОНОЛОГ С ТАЙМИНГАМИ (v2 Production Contract)
═══════════════════════════════════════════
📂 Категория: ${cat.ru}${topicRu ? `\n💡 Идея: ${topicRu}` : ''}${sceneHint ? `\n🎥 Референс: ${sceneHint}` : ''}
👤 Персонаж: ${charA.name_ru} (${cast.speaker_A.age}) — СОЛО
🎭 Динамика: ${pairDynamic}
📍 Локация: ${location.split(',')[0]}
💡 Освещение: ${lightingMood.mood}
👗 Гардероб: ${wardrobeA}
🪑 Реквизит: ${propAnchor}

📷 ФОТО = ВИЗУАЛЬНЫЙ ЯКОРЬ (Identity Lock)
═══════════════════════════════════════════
⚠️ Фото — кадр 0. Видео генерируется ИЗ него. Консистентность зависит от фото.
1. Сгенерируй фото по «photo_prompt» ОДИН РАЗ для персонажа
2. Проверь ВСЕ детали: цвет кожи, морщины, шрамы, борода, очки, головной убор, серьги, ткань, узор
3. Используй ЭТО ЖЕ фото для КАЖДОГО ролика с этим персонажем
4. НЕ генерируй новое фото каждый раз — сломаешь консистентность
5. Если деталь пропала — перегенерируй фото до идеала
═══════════════════════════════════════════

[0.00–0.70] 🎣 ХУК: ${mergedHookObj.action_ru}
  🔊 Звук: ${mergedHookObj.audio}
  🎭 Стиль хука: ${charA.modifiers?.hook_style || 'внимание к камере'}

[0.70–7.00] 🎤 ${charA.name_ru} (${charA.vibe_archetype || 'соло'}):
  «${dialogueA}»
  💬 Темп: ${charA.speech_pace} | Слов: 15-30 | Окно: 6.3с | ${charA.swear_level > 0 ? 'мат как акцент' : 'без мата'}
  🗣 Голос: ${charA.speech_pace === 'fast' ? 'быстрый, эмоциональный, с надрывом' : charA.speech_pace === 'slow' ? 'низкий, тяжёлый, каждое слово с весом' : 'средний тембр, нарастающая эмоция'}
  🎭 Микрожест: ${anchorA.micro_gesture || charA.modifiers?.hook_style || 'выразительный жест'}
  💥 KILLER WORD «${killerWord}» → ближе к 6.8s

[7.00–8.00] ${enableLaughter ? '😂' : '😏'} RELEASE: ${enableLaughter ? 'реакция/пауза/хриплый смех' : 'речь заканчивается, тишина — без смеха'}
  🎭 Финал: ${enableLaughter ? (charA.modifiers?.laugh_style || 'усмешка в камеру') : 'уверенное выражение, взгляд в камеру, без смеха'}`
  : `🎬 ДИАЛОГ С ТАЙМИНГАМИ (v2 Production Contract)
═══════════════════════════════════════════
📂 Категория: ${cat.ru}${topicRu ? `\n💡 Идея: ${topicRu}` : ''}${sceneHint ? `\n🎥 Референс: ${sceneHint}` : ''}
👥 Пара: ${charA.name_ru} (${cast.speaker_A.age}) × ${charB.name_ru} (${cast.speaker_B.age})
🎭 Динамика: ${pairDynamic}
📍 Локация: ${location.split(',')[0]}
💡 Освещение: ${lightingMood.mood}
👗 A: ${wardrobeA}
👔 B: ${wardrobeB}
🪑 Реквизит: ${propAnchor}

📷 ФОТО = ВИЗУАЛЬНЫЙ ЯКОРЬ (Identity Lock)
═══════════════════════════════════════════
⚠️ Фото — кадр 0. Видео генерируется ИЗ него. Консистентность зависит от фото.
1. Сгенерируй фото по «photo_prompt» ОДИН РАЗ для этой пары
2. Проверь ВСЕ детали: цвет кожи, морщины, шрамы, борода, очки, головной убор, серьги, украшения, ткань, узор
3. Используй ЭТО ЖЕ фото для КАЖДОГО ролика с этой парой
4. НЕ генерируй новое фото каждый раз — сломаешь консистентность
5. Если деталь пропала (например, золотые зубы, платок) — перегенерируй фото
═══════════════════════════════════════════

[0.00–0.70] 🎣 ХУК: ${mergedHookObj.action_ru}
  🔊 Звук: ${mergedHookObj.audio}
  🎭 Стиль хука A: ${charA.modifiers?.hook_style || 'внимание к камере'}
  ⚡ Стоп-скролл: удар предметом / резкий вдох / микро-экшен

[0.70–3.50] 🅰️ ${charA.name_ru} (${charA.vibe_archetype || 'роль A'}):
  «${dialogueA}»
  💬 Темп: ${charA.speech_pace} | Слов: 4-10 (${charA.speech_pace === 'slow' ? 'макс 5' : charA.speech_pace === 'fast' ? 'до 8-10' : '5-7'}) | Окно: 2.8с | ${charA.swear_level > 0 ? 'мат как акцент' : 'без мата'}
  🗣 Голос: ${charA.speech_pace === 'fast' ? 'быстрый, эмоциональный, с надрывом' : charA.speech_pace === 'slow' ? 'низкий, тяжёлый, каждое слово с весом' : 'средний тембр, нарастающая индигнация'}
  🎭 Микрожест: ${anchorA.micro_gesture || charA.modifiers?.hook_style || 'выразительный жест'}
  🚫 Рот B: СТРОГО ЗАКРЫТ — только микро-мимика (side-eye, ноздри, бровь)

[3.50–7.00] 🅱️ ${charB.name_ru} (${charB.vibe_archetype || 'роль B'}):
  «${dialogueB}»
  💬 Темп: ${charB.speech_pace} | Слов: 4-12 (${charB.speech_pace === 'slow' ? 'макс 7' : charB.speech_pace === 'fast' ? 'до 10-12' : '6-8'}) | Окно: 3.5с | паузы = сила
  🗣 Голос: ${charB.speech_pace === 'slow' ? 'низкий, размеренный, слова как камни' : charB.speech_pace === 'fast' ? 'стаккато, отрывистый, резкие паузы' : 'контролируемый, на killer word голос падает до шёпота'}
  💥 KILLER WORD «${killerWord}» → ближе к 6.8s
  🚫 Рот A: СТРОГО ЗАКРЫТ — замирает в пафосной позе

[7.00–8.00] ${enableLaughter ? '😂' : '🤐'} RELEASE: ${enableLaughter ? releaseObj.action_ru : 'тишина после панчлайна — без смеха'}
${enableLaughter ? `  🔊 Общий заразительный «хриплый» смех. Тряска камеры. Rewatch-bait 0.3с
  🎭 Смех A: ${charA.modifiers?.laugh_style || 'искренний смех'}
  🎭 Смех B: ${charB.modifiers?.laugh_style || 'довольный смешок'}` : `  🔇 БЕЗ СМЕХА. Замершие выражения лиц. Rewatch-bait 0.3с`}

═══════════════════════════════════════════


📸 INSTAGRAM PACK
═══════════════════════════════════════════

📊 1. Детальный анализ (для понимания залёта):
• Сюжет: ${charA.name_ru} идёт в атаку с вопросом про ${cat.ru.toLowerCase()}. ${charB.name_ru} оказывается прижат к стенке.
• Панчлайн: Killer word «${killerWord}» переворачивает весь разговор — то, что казалось нападением, оказывается точным попаданием.
• Почему сработает: Каждый хоть раз был в такой ситуации — этот момент узнавания и есть главный триггер пересылки.

───────────────────────────────────────────

📝 2. Текст для описания (Caption) + Байт:
(Копируй отсюда) 👇

${engage.viralTitle} ${charA.name_ru} выдала такое, что ${charB.name_ru} не нашёлся что ответить. Реакция — бесценна! 😂

**${engage.shareBait}** 👇

───────────────────────────────────────────

#️⃣ 3. Блок хештегов (ВЧ/СЧ/НЧ):
(Копируй и вставляй первым комментарием) 👇

${engage.hashtags.join(' ')}

───────────────────────────────────────────

🎬 4. Текст на видео (Хук):
Напиши это крупно в начале, чтобы зацепить взгляд:
• «${charA.name_ru} подловила на самом интересном...»
• «Когда ${cat.ru.toLowerCase()} доводит до точки кипения 🔥»
• «Его реакция на последнее слово? Бесценно 💀»

───────────────────────────────────────────

💡 5. Лайфхак для охватов:
В этой теме важно спровоцировать спор. Напиши в закрепе:
«${engage.pinComment}»
Этот «махач» в комментах вытолкнет ролик в рекомендации. 🚀

📌 ЗАКРЕП (первый коммент от автора):
${engage.pinComment}

💬 ПЕРВЫЙ КОММЕНТ (сразу после публикации):
${engage.firstComment}

───────────────────────────────────────────

📱 СТРАТЕГИЯ ПУБЛИКАЦИИ:
• Заголовок из блока 2 → в описание поста (caption). Без хештегов.
• Хештеги из блока 3 → в ПЕРВЫЙ коммент от автора (IG не режет охват).
• Закреп → закрепить коммент сверху.
• Первый коммент → постить через 1-2 мин после публикации.
• Серия: используй ${engage.seriesTag} на каждом видео этой пары.${product_info?.description_en ? `

📦 ТОВАР В КАДРЕ:
═══════════════════════════════════════════
Описание товара (EN, для промпта): ${product_info.description_en.slice(0, 300)}${product_info.description_en.length > 300 ? '...' : ''}

⚠️ ВАЖНО: Товар должен быть в кадре точно как на исходном фото!
• Персонаж A держит/показывает товар во время своей реплики
• Товар остаётся видимым на протяжении всего ролика
• Цвета, форма, бренд — строго как на оригинальном фото` : ''}${reference_style?.description_en ? `

🎨 ВИЗУАЛЬНЫЙ РЕФЕРЕНС:
═══════════════════════════════════════════
Описание стиля (EN, для промпта): ${reference_style.description_en.slice(0, 300)}${reference_style.description_en.length > 300 ? '...' : ''}

💡 Повтори освещение, цветовую палитру и настроение с загруженного референса!` : ''}`;

  // ── BLUEPRINT JSON ──
  const blueprint_json = {
    version: '2.0',
    ...(topicRu ? { topic_ru: topicRu } : {}),
    ...(topicEn ? { topic_en: topicEn } : {}),
    ...(sceneHint ? { scene_reference: sceneHint } : {}),
    category: cat,
    lighting: lightingMood,
    scenes: soloMode ? [
      { id: 1, segment: 'hook', action: mergedHookObj.action_en, speaker: 'A', start: GRID_V2.hook.start, end: GRID_V2.hook.end, dialogue_ru: '', speech_hints: `${mergedHookObj.audio}, ${charA.modifiers?.hook_style || 'attention grab'}` },
      { id: 2, segment: 'monologue', action: `${charA.vibe_archetype || 'Solo performer'} delivers monologue`, speaker: 'A', start: GRID_V2.act_A.start, end: GRID_V2.act_B.end, dialogue_ru: dialogueA, speech_hints: `${charA.speech_pace} pace, 15-30 words, solo monologue, killer word "${killerWord}" near end, ${anchorA.micro_gesture || 'emphatic gestures'}` },
      { id: 3, segment: 'release', action: releaseObj.action_en, speaker: 'A', start: GRID_V2.release.start, end: GRID_V2.release.end, dialogue_ru: '', speech_hints: `zero words, ${charA.modifiers?.laugh_style || 'smirk to camera'}, solo reaction` },
    ] : [
      { id: 1, segment: 'hook', action: mergedHookObj.action_en, speaker: 'A', start: GRID_V2.hook.start, end: GRID_V2.hook.end, dialogue_ru: '', speech_hints: `${mergedHookObj.audio}, ${charA.modifiers?.hook_style || 'attention grab'}` },
      { id: 2, segment: 'act_A', action: `${charA.vibe_archetype || 'Provocateur'} delivers ${charA.speech_pace === 'fast' ? 'rapid-fire indignation' : charA.speech_pace === 'slow' ? 'slow-burn provocation' : 'passionate provocation'}`, speaker: 'A', start: GRID_V2.act_A.start, end: GRID_V2.act_A.end, dialogue_ru: dialogueA, speech_hints: `${charA.speech_pace} pace, 4-10 words, ${charA.swear_level > 1 ? 'expressive accent' : 'controlled'}, B sealed, ${anchorA.micro_gesture || 'emphatic gestures'}` },
      { id: 3, segment: 'act_B', action: `${charB.vibe_archetype || 'Grounded responder'} delivers ${charB.speech_pace === 'slow' ? 'devastating measured punchline' : charB.speech_pace === 'fast' ? 'rapid-fire killer response' : 'controlled punchline buildup'}`, speaker: 'B', start: GRID_V2.act_B.start, end: GRID_V2.act_B.end, dialogue_ru: dialogueB, speech_hints: `${charB.speech_pace} pace, 4-12 words, killer word "${killerWord}" near end, A frozen, ${anchorB.micro_gesture || 'subtle gesture on punchline'}` },
      { id: 4, segment: 'release', action: releaseObj.action_en, speaker: 'both', start: GRID_V2.release.start, end: GRID_V2.release.end, dialogue_ru: '', speech_hints: `zero words, ${charB.modifiers?.laugh_style || 'natural laugh'}, shared laugh` },
    ],
    dialogue_segments: soloMode ? [
      { speaker: 'A', text_ru: dialogueA, start: GRID_V2.act_A.start, end: GRID_V2.act_B.end, word_range: '15-30' },
    ] : [
      { speaker: 'A', text_ru: dialogueA, start: GRID_V2.act_A.start, end: GRID_V2.act_A.end, word_range: '4-10' },
      { speaker: 'B', text_ru: dialogueB, start: GRID_V2.act_B.start, end: GRID_V2.act_B.end, word_range: '4-12' },
    ],
    timing_grid: {
      total: 8.0,
      hook: [GRID_V2.hook.start, GRID_V2.hook.end],
      A: [GRID_V2.act_A.start, GRID_V2.act_A.end],
      B: [GRID_V2.act_B.start, GRID_V2.act_B.end],
      release: [GRID_V2.release.start, GRID_V2.release.end],
      killer_word_at: 6.8,
      gap_between_speakers: '0.15-0.25s',
    },
    identity_anchors: soloMode ? {
      A: charA.identity_anchors || {},
    } : {
      A: charA.identity_anchors || {},
      B: charB.identity_anchors || {},
    },
    cast_summary: soloMode ? {
      A: { name: charA.name_ru, age: cast.speaker_A.age, vibe: charA.vibe_archetype, pace: charA.speech_pace, compatibility: charA.compatibility },
      mode: 'solo',
    } : {
      A: { name: charA.name_ru, age: cast.speaker_A.age, vibe: charA.vibe_archetype, pace: charA.speech_pace, compatibility: charA.compatibility },
      B: { name: charB.name_ru, age: cast.speaker_B.age, vibe: charB.vibe_archetype, pace: charB.speech_pace, compatibility: charB.compatibility },
      pair_dynamic: pairDynamic,
    },
  };

  // ── QC Gate ──
  const qc = runQCGate(blueprint_json, cast);

  // ── Validate ──
  const output = { photo_prompt_en_json, video_prompt_en_json, ru_package, blueprint_json };
  const validation = runAllValidations(output, historyCache);

  // ── Update history ──
  historyCache.addGeneration({
    location,
    props: [propAnchor],
    wardrobeA,
    wardrobeB,
    category: cat.ru,
  });

  const log = {
    seed,
    generator_version: '2.0',
    memory_hash: hashMem,
    solo_mode: soloMode,
    characters: soloMode ? [charA.id] : [charA.id, charB.id],
    vibes: soloMode ? [charA.vibe_archetype] : [charA.vibe_archetype, charB.vibe_archetype],
    category: cat,
    engagement: {
      viral_title: engage.viralTitle,
      share_bait: engage.shareBait,
      pin_comment: engage.pinComment,
      first_comment: engage.firstComment,
      series_tag: engage.seriesTag,
      hashtag_count: engage.hashtags.length,
      hashtags: engage.hashtags,
    },
    qc_gate: { passed: qc.passed, total: qc.total, ok: qc.ok, hard_fails: qc.hard_fails },
    warnings: [...warnings, ...validation.warnings],
    auto_fixes: autoFixes,
    duration_estimate: estimate.total,
    input_mode,
    timestamp: new Date().toISOString(),
  };

  return {
    photo_prompt_en_json,
    video_prompt_en_json,
    veo_prompt,
    ru_package,
    blueprint_json,
    log,
    warnings: [...validation.warnings, ...(qc.ok ? [] : [`QC Gate: ${qc.passed}/${qc.total} (need ≥9)${qc.hard_fails.length ? ', HARD FAIL: ' + qc.hard_fails.join(', ') : ''}`])],
    auto_fixes: [...autoFixes, ...validation.auto_fixes],
    duration_estimate: estimate,
    qc_gate: qc,
    // Context for API mode — sent to server for AI refinement
    _apiContext: {
      charA, charB, category: cat, topic_ru: topicRu, scene_hint: sceneHint,
      input_mode, video_meta, product_info, reference_style, location, wardrobeA, wardrobeB, soloMode, enableLaughter,
      propAnchor, lightingMood, hookAction: mergedHookObj, releaseAction: releaseObj,
      aesthetic, script_ru, cinematography, thread_memory,
      dialogue_override: dialogue_override || null,
      // Fallback dialogue for mergeAIResult when AI doesn't return dialogue
      dialogueA, dialogueB, killerWord,
      // Remake instruction — when video reference is provided, AI must replicate it
      remake_mode: !!(video_meta?.url || video_meta?.title || video_meta?.cover_base64),
      remake_instruction: (video_meta?.url || video_meta?.title || video_meta?.cover_base64) ? buildRemakeInstruction(video_meta, charA, charB) : null,
    },
  };
}

// ─── MERGE AI RESULT INTO LOCAL TEMPLATE ──
// Takes local generation (structural) + AI engine output (creative) → merged result
export function mergeAIResult(localResult, aiData) {
  if (!aiData) return localResult;

  const ctx = localResult._apiContext;
  const g = aiData;

  // Deep clone to avoid mutating original
  const r = JSON.parse(JSON.stringify(localResult));

  // ── 0. Humor category: AI engine invents its own category ──
  if (g.humor_category_ru) {
    r.log.category = { ru: g.humor_category_ru, en: g.humor_category_ru };
    ctx.category = { ru: g.humor_category_ru, en: g.humor_category_ru };
  }

  // ── 1. Photo prompt: replace scene with AI engine's ultra-detailed version ──
  if (g.photo_scene_en) {
    // ── IDENTITY LOCK: append canonical character_en to photo scene ──
    const cA = ctx.charA;
    const cB = ctx.charB;
    const idA = cA?.prompt_tokens?.character_en;
    const idB = cB?.prompt_tokens?.character_en;
    let photoScene = g.photo_scene_en;
    if (idA || idB) {
      const _idLockParts = (c, id, wFallback) => {
        const ia = c?.identity_anchors || {};
        const bio = c?.biology_override || {};
        const parts = [id];
        parts.push(`Wardrobe: ${ia.wardrobe_anchor || wFallback || ''}`);
        if (ia.signature_element) parts.push(`Signature: ${ia.signature_element}`);
        if (ia.glasses_anchor && ia.glasses_anchor !== 'none') parts.push(`Glasses: ${ia.glasses_anchor}`);
        if (ia.headwear_anchor && ia.headwear_anchor !== 'none') parts.push(`Headwear: ${ia.headwear_anchor}`);
        if (ia.jewelry_anchors && ia.jewelry_anchors !== 'none') parts.push(`Jewelry: ${ia.jewelry_anchors}`);
        if (bio.hair_tokens) parts.push(`Hair: ${safeArr(bio.hair_tokens)}`);
        if (bio.eye_tokens) parts.push(`Eyes: ${safeArr(bio.eye_tokens)}`);
        if (bio.scar_mark_tokens) parts.push(`Marks: ${safeArr(bio.scar_mark_tokens)}`);
        if (bio.voice_texture_tokens) parts.push(`Voice: ${safeArr(bio.voice_texture_tokens)}`);
        return parts.join('. ');
      };
      const idBlock = [
        idA ? `EXACT CHARACTER A: ${_idLockParts(cA, idA, ctx.wardrobeA)}.` : '',
        idB ? `EXACT CHARACTER B: ${_idLockParts(cB, idB, ctx.wardrobeB)}.` : '',
      ].filter(Boolean).join(' ');
      photoScene += ' ' + idBlock;
    }
    r.photo_prompt_en_json.scene = photoScene;
  }

  // ── 2. Video prompt: replace dialogue (AI engine generates fresh lines) ──
  // If dialogue_override is set, user explicitly chose this dialogue — skip AI engine's
  const hasDialogueOverride = !!(ctx.dialogue_override?.A);
  if (!hasDialogueOverride) {
    if (g.dialogue_A_ru) r.video_prompt_en_json.dialogue.final_A_ru = g.dialogue_A_ru;
    if (g.dialogue_B_ru) r.video_prompt_en_json.dialogue.final_B_ru = g.dialogue_B_ru;
    if (g.killer_word) {
      r.video_prompt_en_json.dialogue.killer_word = g.killer_word;
      // Sync killer_word into vibe.punchline so it matches actual dialogue
      if (r.video_prompt_en_json.vibe?.punchline) {
        r.video_prompt_en_json.vibe.punchline = r.video_prompt_en_json.vibe.punchline
          .replace(/Killer word "[^"]*"/, `Killer word "${g.killer_word}"`);
      }
    }
  }

  // ── 3. Video prompt: replace emotion arc ──
  if (g.video_emotion_arc) {
    const arc = g.video_emotion_arc;
    r.video_prompt_en_json.emotion_arc = {
      hook: arc.hook_en || r.video_prompt_en_json.emotion_arc.hook,
      act_A: arc.monologue_en || arc.act_A_en || r.video_prompt_en_json.emotion_arc.act_A,
      act_B: arc.act_B_en || r.video_prompt_en_json.emotion_arc.act_B,
      release: arc.release_en || r.video_prompt_en_json.emotion_arc.release,
    };
  }

  // ── 4. Video prompt: replace atmosphere ──
  if (g.video_atmosphere_en) {
    r.video_prompt_en_json.spatial.environment_interaction = g.video_atmosphere_en;
  }

  // ── 5. Blueprint: replace dialogue in scenes (solo-aware) ──
  // Skip if dialogue_override — user's edited dialogue is already in the blueprint from generator
  const isSoloMerge = ctx.soloMode || (ctx.charA && ctx.charB && ctx.charA.id === ctx.charB.id);
  if (!hasDialogueOverride) {
    if (g.dialogue_A_ru) {
      // In solo mode, scene[1] is 'monologue'; in duo mode, scene[1] is 'act_A'
      if (r.blueprint_json.scenes[1]) r.blueprint_json.scenes[1].dialogue_ru = g.dialogue_A_ru;
      if (r.blueprint_json.dialogue_segments?.[0]) r.blueprint_json.dialogue_segments[0].text_ru = g.dialogue_A_ru;
    }
    if (g.dialogue_B_ru && !isSoloMerge) {
      // Only update B in duo mode — in solo mode there is no scene[2] 'act_B' or dialogue_segments[1]
      if (r.blueprint_json.scenes[2]) r.blueprint_json.scenes[2].dialogue_ru = g.dialogue_B_ru;
      if (r.blueprint_json.dialogue_segments?.[1]) r.blueprint_json.dialogue_segments[1].text_ru = g.dialogue_B_ru;
    }
  }

  // ── 5a. Blueprint: sync killer_word ──
  if (g.killer_word && !hasDialogueOverride) {
    r.blueprint_json.killer_word = g.killer_word;
  }

  // ── 5b. Blueprint: add добивка if present ──
  const dA2 = g.dialogue_A2_ru || null;
  if (dA2 && r.blueprint_json.dialogue_segments) {
    // Add A2 segment if not already present
    const hasA2 = r.blueprint_json.dialogue_segments.some(s => s.speaker === 'A2');
    if (!hasA2) {
      r.blueprint_json.dialogue_segments.push({ speaker: 'A2', text_ru: dA2, role: 'добивка' });
    }
  }

  // ── 6. Rebuild RU package with AI engine's creative content ──
  // If dialogue_override, prefer user's edited dialogue over AI engine's
  const dA = hasDialogueOverride ? (ctx.dialogueA || '—') : (g.dialogue_A_ru || ctx.dialogueA || '—');
  const dB = hasDialogueOverride ? (ctx.dialogueB || '—') : (g.dialogue_B_ru || ctx.dialogueB || '—');
  const kw = hasDialogueOverride ? (r.blueprint_json?.killer_word || '—') : (g.killer_word || '—');
  const charA = ctx.charA;
  const charB = ctx.charB;
  const cast = r.video_prompt_en_json.cast || {};
  const anchorA = charA.identity_anchors || {};
  const anchorB = charB.identity_anchors || {};

  const pairDynamic = charA.compatibility === 'chaotic' && charB.compatibility === 'calm' ? '🔥 Взрывная пара: хаос vs спокойствие'
    : charA.compatibility === 'chaotic' || charB.compatibility === 'chaotic' ? '🌪 Хаотичная пара'
    : charA.compatibility === 'conflict' || charB.compatibility === 'conflict' ? '⚡ Конфликтная пара'
    : charA.compatibility === 'meme' && charB.compatibility === 'meme' ? '😂 Мем-пара'
    : '⚖️ Сбалансированная пара';

  // Engagement from AI engine
  const viralTitle = g.viral_title_ru || r.log?.engagement?.viral_title || '';
  const shareBait = g.share_bait_ru || r.log?.engagement?.share_bait || '';
  const pinComment = g.pin_comment_ru || r.log?.engagement?.pin_comment || '';
  const firstComment = g.first_comment_ru || r.log?.engagement?.first_comment || '';
  const hashtags = (g.hashtags || r.log?.engagement?.hashtags || []).map(t => t.startsWith('#') ? t : '#' + t);
  const isSolo = ctx.soloMode || (charA.id === charB.id);
  const seriesTag = isSolo
    ? '#' + (charA.name_ru || '').replace(/\s+/g, '').toLowerCase() + 'solo'
    : '#' + (charA.name_ru || '').replace(/\s+/g, '').toLowerCase() + 'vs' + (charB.name_ru || '').replace(/\s+/g, '').toLowerCase();

  // ── Merge AI engine's product_in_frame_en if available (richer than local description) ──
  if (g.product_in_frame_en && ctx.product_info) {
    ctx.product_info.description_en = g.product_in_frame_en;
  }

  // Instagram Pack from AI engine
  const instaAnalysis = g.insta_analysis_ru || (isSolo ? {
    plot: `${charA.name_ru} выдаёт монолог про ${ctx.category?.ru || 'тему'} — прямо в камеру, без фильтров.`,
    punchline: `Killer word «${kw}» в конце переворачивает весь смысл сказанного.`,
    why_viral: `Каждый хоть раз думал то же самое — этот момент узнавания и есть главный триггер пересылки.`,
  } : {
    plot: `${charA.name_ru} идёт в атаку с вопросом про ${ctx.category?.ru || 'тему'}. ${charB.name_ru} оказывается прижат к стенке.`,
    punchline: `Killer word «${kw}» переворачивает весь разговор — то, что казалось нападением, оказывается точным попаданием.`,
    why_viral: `Каждый хоть раз был в такой ситуации — этот момент узнавания и есть главный триггер пересылки.`,
  });
  const instaCaption = g.insta_caption_ru || (isSolo
    ? `${viralTitle} ${charA.name_ru} сказал(а) такое, что комменты взорвутся. 😂 Перешли тому, кто точно узнает себя! 👇`
    : `${viralTitle} ${charA.name_ru} выдала такое, что ${charB.name_ru} не нашёлся что ответить. Реакция — бесценна! 😂 Перешли это видео тому, кто точно узнает себя! 👇`);
  const instaHookTexts = g.insta_hook_texts_ru || [
    `${charA.name_ru} подловила на самом интересном...`,
    `Когда ${ctx.category?.ru?.toLowerCase() || 'жиза'} доводит до точки кипения 🔥`,
    `Его реакция на последнее слово? Бесценно 💀`,
  ];
  const instaEngagementTip = g.insta_engagement_tip_ru || `В этой теме важно спровоцировать спор. Напиши в закрепе:\n«${pinComment}»\nЭтот «махач» в комментах вытолкнет ролик в рекомендации. 🚀`;

  r.ru_package = isSolo
  ? `🎬 МОНОЛОГ С ТАЙМИНГАМИ (FERIXDI AI Production)
═══════════════════════════════════════════
📂 Категория: ${ctx.category.ru}${ctx.topic_ru ? `\n💡 Идея: ${ctx.topic_ru}` : ''}${ctx.scene_hint ? `\n🎥 Референс: ${ctx.scene_hint}` : ''}
🤖 Сгенерировано FERIXDI AI — уникальный контент
👤 Персонаж: ${charA.name_ru} (${cast.speaker_A?.age || charA.biology_override?.age || 'adult'}) — СОЛО
🎭 Архетип: ${charA.vibe_archetype || '—'}
📍 Локация: ${ctx.location.split(',')[0]}
💡 Освещение: ${ctx.lightingMood.mood}
👗 Гардероб: ${ctx.wardrobeA}
🪑 Реквизит: ${ctx.propAnchor}

[0.00–0.70] 🎣 ХУК: ${ctx.hookAction.action_ru}
  🔊 Звук: ${ctx.hookAction.audio}
  🎭 Стиль хука: ${charA.modifiers?.hook_style || 'внимание к камере'}

[0.70–7.00] 🎤 ${charA.name_ru} (${charA.vibe_archetype || 'соло'}):
  «${dA}»
  💬 Темп: ${charA.speech_pace} | ${charA.swear_level > 0 ? 'мат как акцент' : 'без мата'}
  🗣 Голос: ${charA.speech_pace === 'fast' ? 'быстрый, эмоциональный, с надрывом' : charA.speech_pace === 'slow' ? 'низкий, тяжёлый, каждое слово с весом' : 'средний тембр, нарастающая эмоция'}
  🎭 Микрожест: ${anchorA.micro_gesture || charA.modifiers?.hook_style || 'выразительный жест'}
  💥 KILLER WORD «${kw}» → ближе к 6.8s

[7.00–8.00] ${ctx.enableLaughter ? '😂' : '😏'} RELEASE: ${ctx.enableLaughter ? 'реакция/пауза/хриплый смех' : 'речь заканчивается, тишина — без смеха'}
  🎭 Финал: ${ctx.enableLaughter ? (charA.modifiers?.laugh_style || 'усмешка в камеру') : 'уверенное выражение, без смеха'}`

  : `🎬 ${ctx.remake_mode ? 'РЕМЕЙК' : 'ДИАЛОГ'} С ТАЙМИНГАМИ (FERIXDI AI Production)
═══════════════════════════════════════════
📂 Категория: ${ctx.category.ru}${ctx.topic_ru ? `\n💡 Идея: ${ctx.topic_ru}` : ''}${ctx.scene_hint ? `\n🎥 Референс: ${ctx.scene_hint}` : ''}${ctx.remake_mode ? `\n🔄 Режим: РЕМЕЙК (копия оригинала + харизма наших персонажей)` : ''}
🤖 Сгенерировано FERIXDI AI — уникальный контент
👥 Пара: ${charA.name_ru} (${cast.speaker_A?.age || charA.biology_override?.age || 'adult'}) × ${charB.name_ru} (${cast.speaker_B?.age || charB.biology_override?.age || 'adult'})
🎭 Динамика: ${pairDynamic}
📍 Локация: ${ctx.location.split(',')[0]}
💡 Освещение: ${ctx.lightingMood.mood}
👗 A: ${ctx.wardrobeA}
👔 B: ${ctx.wardrobeB}
🪑 Реквизит: ${ctx.propAnchor}

[0.00–0.70] 🎣 ХУК: ${ctx.hookAction.action_ru}
  🔊 Звук: ${ctx.hookAction.audio}
  🎭 Стиль хука A: ${charA.modifiers?.hook_style || 'внимание к камере'}
  ⚡ Стоп-скролл: удар предметом / резкий вдох / микро-экшен

[0.70–3.50] 🅰️ ${charA.name_ru} (${charA.vibe_archetype || 'роль A'}):
  «${dA}»
  💬 Темп: ${charA.speech_pace} | ${charA.swear_level > 0 ? 'мат как акцент' : 'без мата'}
  🗣 Голос: ${charA.speech_pace === 'fast' ? 'быстрый, эмоциональный, с надрывом' : charA.speech_pace === 'slow' ? 'низкий, тяжёлый, каждое слово с весом' : 'средний тембр, нарастающая индигнация'}
  🎭 Микрожест: ${anchorA.micro_gesture || charA.modifiers?.hook_style || 'выразительный жест'}
  🚫 Рот B: СТРОГО ЗАКРЫТ — только микро-мимика (side-eye, ноздри, бровь)

[3.50–7.00] 🅱️ ${charB.name_ru} (${charB.vibe_archetype || 'роль B'}):
  «${dB}»
  💬 Темп: ${charB.speech_pace} | паузы = сила
  🗣 Голос: ${charB.speech_pace === 'slow' ? 'низкий, размеренный, слова как камни' : charB.speech_pace === 'fast' ? 'стаккато, отрывистый, резкие паузы' : 'контролируемый, на killer word голос падает до шёпота'}
  💥 KILLER WORD «${kw}» → ближе к 6.8s
  🚫 Рот A: СТРОГО ЗАКРЫТ — замирает в пафосной позе
${dA2 ? `
[~6.80–7.00] 🅰️ ДОБИВКА ${charA.name_ru}:
  «${dA2}»
  💬 1-4 слова, короткая финальная фраза
` : ''}
[7.00–8.00] ${ctx.enableLaughter ? '😂' : '🤐'} RELEASE: ${ctx.enableLaughter ? ctx.releaseAction.action_ru : 'тишина после панчлайна — без смеха'}
${ctx.enableLaughter ? `  🔊 Общий заразительный «хриплый» смех. Тряска камеры. Rewatch-bait в последние 0.3с
  🎭 Смех A: ${charA.modifiers?.laugh_style || 'искренний смех'}
  🎭 Смех B: ${charB.modifiers?.laugh_style || 'довольный смешок'}` : `  🔇 БЕЗ СМЕХА. Замершие выражения лиц. Rewatch-bait 0.3с`}

═══════════════════════════════════════════


📸 INSTAGRAM PACK
═══════════════════════════════════════════

📊 1. Детальный анализ (для понимания залёта):
${instaAnalysis.plot ? `• Сюжет: ${instaAnalysis.plot}` : ''}
${instaAnalysis.punchline ? `• Панчлайн: ${instaAnalysis.punchline}` : ''}
${instaAnalysis.why_viral ? `• Почему сработает: ${instaAnalysis.why_viral}` : ''}

───────────────────────────────────────────

📝 2. Текст для описания (Caption) + Байт:
(Копируй отсюда) 👇

${instaCaption}

**${shareBait}** 👇

───────────────────────────────────────────

#️⃣ 3. Блок хештегов (ВЧ/СЧ/НЧ):
(Копируй и вставляй первым комментарием) 👇

${hashtags.join(' ')}

───────────────────────────────────────────

🎬 4. Текст на видео (Хук):
Напиши это крупно в начале, чтобы зацепить взгляд:
${instaHookTexts.map(h => `• «${h}»`).join('\n')}

───────────────────────────────────────────

💡 5. Лайфхак для охватов:
${instaEngagementTip}

📌 ЗАКРЕП (первый коммент от автора):
${pinComment}

💬 ПЕРВЫЙ КОММЕНТ (сразу после публикации):
${firstComment}

───────────────────────────────────────────

📱 СТРАТЕГИЯ ПУБЛИКАЦИИ:
• Заголовок из блока 2 → в описание поста (caption). Без хештегов.
• Хештеги из блока 3 → в ПЕРВЫЙ коммент от автора (IG не режет охват).
• Закреп → закрепить коммент сверху.
• Первый коммент → постить через 1-2 мин после публикации.
• Серия: используй ${seriesTag} на каждом видео этой пары.${ctx.product_info?.description_en ? `

📦 ТОВАР В КАДРЕ:
═══════════════════════════════════════════
Описание товара (EN, для промпта): ${ctx.product_info.description_en.slice(0, 300)}${ctx.product_info.description_en.length > 300 ? '...' : ''}

⚠️ ВАЖНО: Товар должен быть в кадре точно как на исходном фото!
• Персонаж A держит/показывает товар во время своей реплики
• Товар остаётся видимым на протяжении всего ролика
• Цвета, форма, бренд — строго как на оригинальном фото` : ''}`;

  // ── 6a-sync. Sync _apiContext fallback dialogue with AI engine's values ──
  // Without this, _apiContext.dialogueA/B retain stale local placeholders
  r._apiContext.dialogueA = dA;
  r._apiContext.dialogueB = dB;
  r._apiContext.killerWord = kw;

  // ── 6b. Rebuild Veo 3.1 prompt with AI engine's creative dialogue ──
  // In REMAKE mode: if AI engine provided remake_veo_prompt_en (visual copy of original video),
  // use it directly — it describes the SAME scene/action as the original, not a generic dialogue template.
  if (g.remake_veo_prompt_en && ctx.remake_mode) {
    // ── IDENTITY LOCK ENFORCEMENT ──
    // AI engine paraphrases character descriptions instead of copying verbatim.
    // Inject canonical character_en from catalog to guarantee identity consistency.
    const charA = ctx.charA;
    const charB = ctx.charB;
    const canonicalA = charA?.prompt_tokens?.character_en;
    const canonicalB = charB?.prompt_tokens?.character_en;
    let remakePrompt = g.remake_veo_prompt_en;

    // Append identity override block so Veo always gets the exact catalog descriptions
    if (canonicalA || canonicalB) {
      const _remakeIdParts = (c, canonical, wFallback) => {
        const ia = c?.identity_anchors || {};
        const bio = c?.biology_override || {};
        const parts = [`${canonical}`];
        parts.push(`Wardrobe: ${ia.wardrobe_anchor || wFallback || ''}`);
        if (ia.signature_element) parts.push(`Signature: ${ia.signature_element}`);
        if (ia.glasses_anchor && ia.glasses_anchor !== 'none') parts.push(`Glasses: ${ia.glasses_anchor}`);
        if (ia.headwear_anchor && ia.headwear_anchor !== 'none') parts.push(`Headwear: ${ia.headwear_anchor}`);
        if (ia.jewelry_anchors && ia.jewelry_anchors !== 'none') parts.push(`Jewelry: ${ia.jewelry_anchors}`);
        if (bio.hair_tokens) parts.push(`Hair: ${safeArr(bio.hair_tokens)}`);
        if (bio.eye_tokens) parts.push(`Eyes: ${safeArr(bio.eye_tokens)}`);
        if (bio.scar_mark_tokens) parts.push(`Marks: ${safeArr(bio.scar_mark_tokens)}`);
        if (bio.voice_texture_tokens) parts.push(`Voice: ${safeArr(bio.voice_texture_tokens)}`);
        return parts.join('. ');
      };
      const identityBlock = [
        '\n\n[IDENTITY LOCK — EXACT CHARACTER DESCRIPTIONS (override any paraphrased versions above)]:',
        canonicalA ? `CHARACTER A (${charA.name_ru || 'A'}): ${_remakeIdParts(charA, canonicalA, ctx.wardrobeA)}.` : '',
        canonicalB ? `CHARACTER B (${charB.name_ru || 'B'}): ${_remakeIdParts(charB, canonicalB, ctx.wardrobeB)}.` : '',
      ].filter(Boolean).join('\n');
      remakePrompt += identityBlock;
    }

    // ── DIALOGUE INJECTION ──
    // AI engine's remake prompt describes actions but omits actual spoken words.
    // Veo needs the exact Russian lines for lip-sync.
    const isSoloRemake = ctx.soloMode || (charA && charB && charA.id === charB.id);
    const dialogueBlock = [
      '\n\n[EXACT DIALOGUE — MUST BE SPOKEN IN RUSSIAN WITH PERFECT LIP-SYNC]:',
    ];
    if (isSoloRemake) {
      dialogueBlock.push(`Character speaks in Russian to the camera: "${dA}" — ${charA?.speech_pace || 'normal'} pace. The word "${kw}" is the punchline near the end. Perfect syllable-level lip-sync required.`);
    } else {
      dialogueBlock.push(`A speaks in Russian to the camera: "${dA}" — ${charA?.speech_pace || 'normal'} pace. Perfect syllable-level lip-sync. B listens with MOUTH STRICTLY CLOSED — only micro-expressions.`);
      if (dB && dB !== '—') {
        dialogueBlock.push(`B responds in Russian: "${dB}" — ${charB?.speech_pace || 'normal'} pace. The word "${kw}" is the punchline that reframes everything. A freezes mid-gesture.`);
      }
    }
    remakePrompt += dialogueBlock.join('\n');

    r.veo_prompt = remakePrompt;
    r.is_remake = true; // Flag for main.js: DO NOT re-translate this prompt (it's already English)
  } else {
    const isExplicitIndoorMerge = /interior|kitchen|stairwell|marshrutka|polyclinic|barn|attic|cellar|bathhouse|bedroom|living.?room|apartment|office|elevator|corridor|hallway|basement|laundry|fridge|garage|bathroom|sauna|gym|cafe|restaurant|shop|store|classroom|library|closet|studio/i.test(ctx.location || '');
    const isOutdoorMerge = !isExplicitIndoorMerge && /garden|outdoor|park|bench|bazaar|bus.?stop|train|playground|fishing|chicken|cemetery|veranda|beach|shore|pier|dock|pool|river|lake|field|forest|mountain|road|street|sidewalk|market|parking|bridge|roof|terrace|porch|courtyard|alley|balcony/i.test(ctx.location || '');
    r.veo_prompt = buildVeoPrompt({
      charA, charB, cast: r.video_prompt_en_json.cast || {},
      location: ctx.location, lightingMood: ctx.lightingMood,
      wardrobeA: ctx.wardrobeA, wardrobeB: ctx.wardrobeB,
      hookObj: ctx.hookAction, releaseObj: ctx.releaseAction,
      propAnchor: ctx.propAnchor, dialogueA: dA, dialogueB: dB,
      killerWord: kw, cat: ctx.category, topicRu: ctx.topic_ru,
      aesthetic: ctx.aesthetic, cinematography: ctx.cinematography,
      isOutdoor: isOutdoorMerge, dialogueA2: dA2,
      productInfo: ctx.product_info,
      referenceStyle: ctx.reference_style,
      soloMode: ctx.soloMode || false,
      enableLaughter: ctx.enableLaughter !== false,
    });
  }

  // ── 7. Post-merge dialogue validation ──
  // Warn if AI engine's dialogue is too long for timing windows
  // VIDEO/SCRIPT mode: higher threshold (warn only, never block — dialogue is verbatim from original)
  const isRemake = ctx.remake_mode || ctx.input_mode === 'video' || ctx.input_mode === 'script';
  const maxA = isRemake ? 25 : 10;
  const maxB = isRemake ? 30 : 12;
  const validateWordCount = (text, maxWords, label) => {
    if (!text || text === '—') return null;
    const words = text.replace(/\|/g, '').trim().split(/\s+/).filter(Boolean).length;
    if (words > maxWords) return `${label}: ${words} слов (макс ${maxWords}). ${isRemake ? 'Оригинальный диалог длинный — можно сократить в редакторе.' : 'Сократите для точного тайминга.'}`;
    return null;
  };
  const dAwords = validateWordCount(dA, maxA, 'Реплика A');
  const dBwords = isSolo ? null : validateWordCount(dB, maxB, 'Реплика B');
  if (dAwords) r.warnings = [...(r.warnings || []), dAwords];
  if (dBwords) r.warnings = [...(r.warnings || []), dBwords];

  // ── 8. Update log ──
  r.log.generator_version = '2.0-ferixdi';
  r.log.ai_engine = 'ferixdi-ai-v3';
  if (g.viral_title_ru) r.log.engagement.viral_title = g.viral_title_ru;
  if (g.share_bait_ru) r.log.engagement.share_bait = g.share_bait_ru;
  if (g.pin_comment_ru) r.log.engagement.pin_comment = g.pin_comment_ru;
  if (g.first_comment_ru) r.log.engagement.first_comment = g.first_comment_ru;
  if (g.hashtags) {
    r.log.engagement.hashtags = hashtags;
    r.log.engagement.hashtag_count = hashtags.length;
  }
  r.log.engagement.series_tag = seriesTag;

  // Instagram Pack in log for UI access
  r.log.instagram_pack = {
    analysis: instaAnalysis,
    caption: instaCaption,
    hook_texts: instaHookTexts,
    engagement_tip: instaEngagementTip,
  };

  return r;
}
