import json, os, hashlib

p = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app", "data", "characters.json")
with open(p, "r", encoding="utf-8") as f:
    chars = json.load(f)

# Identity anchor templates by group
SILHOUETTES = {
    "бабки": "round soft face, prominent cheekbones, deep nasolabial folds",
    "деды": "angular jaw, thick brow ridge, weathered nose bridge",
    "мамы": "oval face, defined jawline, subtle crow's feet",
    "папы": "square jaw, broad forehead, stubble shadow",
    "дочери": "youthful oval face, smooth skin, bright eyes",
    "сыновья": "angular young face, sharp jawline, restless eyes",
    "тёщи": "rounded cheeks, pursed lips line, evaluating brow arch",
    "свекрови": "refined bone structure, lifted chin, pearl-smooth skin",
    "соседи": "distinctive nose shape, asymmetric features, lived-in face",
    "продавцы": "broad face, strong chin, weather-worn skin",
    "врачи": "composed features, analytical gaze, clean-cut",
    "учителя": "expressive brow, glasses-shaped marks on nose, kind wrinkles",
    "блогеры": "photogenic symmetry, ring-light catchlights, smooth skin",
    "таксисты": "sun-weathered asymmetry, squint lines, road-worn",
    "бизнесмены": "groomed jawline, confident brow, power posture face",
    "студенты": "soft youthful features, slight acne, tired eyes",
    "пенсионеры": "dignified aging, silver temples shadow, wise eyes",
    "чиновники": "bureaucratic neutrality, thin lips, measured expression",
    "фитнес": "taut skin, defined cheekbones, energetic glow",
    "кошатницы": "gentle round face, warm eyes, soft wrinkles",
    "гопники": "sharp cheekbones, intense brow, street-weathered",
    "бабушки-модницы": "painted brows, lifted cheeks, glamour bone structure",
    "деды-техники": "curious squint, glasses-mark indent, thinker's forehead",
    "тиктокеры": "filter-perfect symmetry, wide eyes, animated brows",
    "охранники": "heavy brow, thick neck shadow, stoic jaw",
    "дворники": "weathered skin, deep smile lines, honest eyes",
    "бабки-целительницы": "ancient bone structure, knowing squint, herb-stained fingers shadow on face",
    "курьеры": "windswept features, helmet-hair indent, breathless cheeks",
    "домоуправы": "authoritative chin, furrowed brow, clipboard posture",
    "астрологи": "mystical bone structure, dreamy unfocused gaze, ringed fingers shadow",
    "психологи": "empathetic brow, listening tilt, composed mouth",
    "экстремалы": "scar-touched features, adrenaline-bright eyes, weather-beaten tan",
}

ELEMENTS = {
    "A": ["bold earrings", "bright headscarf", "statement necklace", "dramatic sleeve", "patterned shawl", "signature ring", "feather brooch", "chain bracelet"],
    "B": ["flat cap", "reading glasses on neck cord", "worn leather belt", "pocket watch chain", "wool vest button", "rolled sleeves showing forearms", "neck scarf knot", "lapel pin"],
}

GESTURES_A = ["lip bite + lingering gaze", "finger point with trembling hand", "hair toss / headscarf adjustment", "slap on own thigh", "dramatic hand wave", "lean into camera"]
GESTURES_B = ["quiet smirk building to grin", "slow eyebrow raise", "head tilt with squint", "arms-cross nod", "glasses push-up", "chin stroke"]

WARDROBE_A = ["silk floral blouse", "leopard-print shawl", "velvet jacket", "embroidered kaftan", "bright knit cardigan", "faux-fur collar coat"]
WARDROBE_B = ["wool fufaika vest", "striped telnyashka", "corduroy jacket", "flannel shirt", "leather work apron", "denim overall strap"]

VIBES_A = ["провокатор — пафос, энергия, давит харизмой", "скандалист — врывается, перебивает, жестикулирует", "блогер — всё на камеру, театральность", "мотиватор — командует, не терпит возражений", "драматург — каждое слово как в театре"]
VIBES_B = ["база — спокойный циничный юмор, добрые глаза", "философ — длинная пауза, потом разрушительный панчлайн", "молчун — три слова и все легли", "ворчун — бубнит, но метко", "наблюдатель — видит всё, говорит редко, но в точку"]

AESTHETICS = ["VIP-деревенский уют", "советская классика", "городской гранж", "дачный шик", "коммунальный реализм", "рыночный хаос", "офисная тоска", "подъездный нуар"]

def h(s):
    return int(hashlib.md5(s.encode()).hexdigest(), 16)

for c in chars:
    seed = h(c["id"])
    grp = c["group"]
    role = c["role_default"]

    sil = SILHOUETTES.get(grp, "distinctive facial features, unique bone structure")
    elems = ELEMENTS.get(role, ELEMENTS["B"])
    gestures = GESTURES_A if role == "A" else GESTURES_B

    c["identity_anchors"] = {
        "face_silhouette": sil,
        "signature_element": elems[seed % len(elems)],
        "micro_gesture": gestures[seed % len(gestures)],
        "wardrobe_anchor": (WARDROBE_A if role == "A" else WARDROBE_B)[seed % len(WARDROBE_A if role == "A" else WARDROBE_B)],
    }

    vibes = VIBES_A if role == "A" else VIBES_B
    c["vibe_archetype"] = vibes[seed % len(vibes)]
    c["world_aesthetic"] = AESTHETICS[seed % len(AESTHETICS)]

with open(p, "w", encoding="utf-8") as f:
    json.dump(chars, f, ensure_ascii=False, indent=1)

print(f"Enriched {len(chars)} characters with v2 identity_anchors + vibe_archetype")
