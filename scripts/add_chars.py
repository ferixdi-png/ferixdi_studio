import json,os
p=os.path.join(os.path.dirname(os.path.dirname(__file__)),"app","data","characters.json")
with open(p,"r",encoding="utf-8") as f: chars=json.load(f)
extra=[
("гопники",[("gop_serega","Гопник Серёга","fast",3,"A","chaotic"),("gop_dimon","Гопник Димон","fast",3,"A","chaotic"),("gop_lyoha","Гопник Лёха","normal",2,"B","meme")]),
("бабушки-модницы",[("mod_klara","Модница Клара","normal",1,"A","meme"),("mod_eleonora","Модница Элеонора","slow",0,"A","meme"),("mod_faina","Модница Фаина","normal",1,"A","meme")]),
("деды-техники",[("tech_semyon","Техно-дед Семён","normal",1,"B","meme"),("tech_arkady","Техно-дед Аркадий","fast",0,"A","meme"),("tech_boris","Техно-дед Борис","slow",1,"B","balanced")]),
("тиктокеры",[("tik_arina","Тиктокер Арина","fast",0,"A","chaotic"),("tik_zhenya","Тиктокер Женя","fast",1,"A","chaotic"),("tik_nikita","Тиктокер Никита","fast",1,"A","meme")]),
("охранники",[("ohr_valery","Охранник Валерий","slow",2,"B","conflict"),("ohr_roma","Охранник Рома","normal",1,"B","balanced")]),
("дворники",[("dvor_jamshed","Дворник Джамшед","slow",0,"B","calm"),("dvor_petrovich","Дворник Петрович","slow",2,"B","balanced")]),
("бабки-целительницы",[("cel_agafya","Целительница Агафья","slow",0,"B","meme"),("cel_praskovya","Целительница Прасковья","slow",0,"B","calm")]),
("курьеры",[("kur_timur","Курьер Тимур","fast",1,"A","chaotic"),("kur_vanya","Курьер Ваня","fast",2,"A","meme")]),
("домоуправы",[("dom_stepanovna","Домоуправ Степановна","normal",1,"A","conflict"),("dom_palych","Домоуправ Палыч","slow",2,"B","conflict")]),
("астрологи",[("astr_zhanna","Астролог Жанна","slow",0,"A","meme"),("astr_edgar","Астролог Эдгар","slow",0,"B","calm")]),
("психологи",[("psy_inna","Психолог Инна","slow",0,"B","calm"),("psy_mark","Психолог Марк","normal",0,"B","balanced")]),
]
HOOKS={"A":["aggressive finger point","slams table","shows phone","holds prop up","waves hands"],"B":["slow head turn","calm stare","raises eyebrow","crosses arms","adjusts glasses"]}
LAUGHS={"chaotic":"wheezing burst","meme":"snort-laugh","conflict":"grudging smirk","calm":"quiet chuckle","balanced":"warm laugh"}
for grp,members in extra:
 for mid,name,pace,swear,role,compat in members:
  h=HOOKS[role];lgh=LAUGHS[compat]
  chars.append({"id":mid,"name_ru":name,"group":grp,"tags":[grp,compat,pace],"appearance_ru":f"Персонаж {name}, типичный представитель группы «{grp}», выразительная внешность, детализированная текстура кожи","speech_style_ru":f"Характерная речь для {grp}, темп {pace}, уровень экспрессии {swear}/3","behavior_ru":f"Поведение: {compat}, роль {role} в диалоге","speech_pace":pace,"swear_level":swear,"role_default":role,"signature_words_ru":[name.split()[-1].lower(),"ну","да"],"prompt_tokens":{"character_en":f"Russian character {name}, {grp} archetype, expressive face, detailed skin microtexture, {pace} speech pace, {compat} energy"},"modifiers":{"hook_style":h[hash(mid)%len(h)],"laugh_style":lgh},"compatibility":compat})
with open(p,"w",encoding="utf-8") as f: json.dump(chars,f,ensure_ascii=False,indent=1)
print(f"Total: {len(chars)} characters")
