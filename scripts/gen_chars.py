import json,os
G=[
("бабки",[("babka_zina","Бабка Зина","fast",3,"A","chaotic"),("babka_valya","Бабка Валя","slow",1,"B","conflict"),("babka_klava","Бабка Клава","fast",2,"A","chaotic"),("babka_lyuda","Бабка Люда","slow",1,"B","calm"),("babka_tamara","Бабка Тамара","normal",1,"A","meme"),("babka_shura","Бабка Шура","fast",2,"A","meme")]),
("деды",[("ded_petya","Дед Петя","slow",2,"B","balanced"),("ded_kolya","Дед Коля","normal",1,"B","meme"),("ded_ivan","Дед Иван","normal",1,"B","conflict"),("ded_vasya","Дед Вася","slow",2,"A","meme"),("ded_grisha","Дед Гриша","slow",2,"B","conflict"),("ded_senya","Дед Сеня","slow",0,"B","calm")]),
("мамы",[("mama_lena","Мама Лена","fast",0,"A","conflict"),("mama_natasha","Мама Наташа","fast",0,"A","calm"),("mama_oksana","Мама Оксана","fast",0,"A","meme"),("mama_sveta","Мама Света","normal",0,"B","conflict"),("mama_ira","Мама Ира","normal",1,"A","meme"),("mama_galya","Мама Галя","normal",1,"A","balanced")]),
("папы",[("papa_dima","Папа Дима","slow",2,"B","balanced"),("papa_andrey","Папа Андрей","normal",2,"B","balanced"),("papa_sasha","Папа Саша","fast",1,"A","meme"),("papa_igor","Папа Игорь","fast",1,"A","chaotic"),("papa_roma","Папа Рома","slow",0,"B","calm"),("papa_zhenya","Папа Женя","normal",1,"B","balanced")]),
("дочери",[("doch_masha","Дочка Маша","fast",1,"A","chaotic"),("doch_katya","Дочка Катя","fast",0,"B","conflict"),("doch_alina","Дочка Алина","normal",0,"A","meme"),("doch_nastya","Дочка Настя","slow",1,"B","conflict"),("doch_polina","Дочка Полина","normal",0,"A","conflict"),("doch_sonya","Дочка Соня","slow",0,"B","calm")]),
("сыновья",[("syn_pasha","Сын Паша","slow",2,"B","meme"),("syn_artyom","Сын Артём","normal",1,"A","meme"),("syn_danya","Сын Даня","normal",1,"B","balanced"),("syn_kirill","Сын Кирилл","fast",2,"A","chaotic"),("syn_maxim","Сын Максим","fast",2,"A","chaotic"),("syn_gleb","Сын Глеб","normal",0,"B","calm")]),
("тёщи",[("teshcha_galya","Тёща Галя","normal",1,"A","conflict"),("teshcha_vera","Тёща Вера","slow",0,"B","meme"),("teshcha_nina","Тёща Нина","normal",0,"B","conflict"),("teshcha_rosa","Тёща Роза","fast",1,"A","chaotic")]),
("свекрови",[("svekrov_lyuba","Свекровь Люба","normal",0,"A","conflict"),("svekrov_rita","Свекровь Рита","normal",0,"A","conflict"),("svekrov_tamara","Свекровь Тамара","slow",1,"B","balanced"),("svekrov_emma","Свекровь Эмма","fast",0,"A","meme")]),
("соседи",[("sosed_gena","Сосед Гена","fast",3,"A","chaotic"),("sosed_tolik","Сосед Толик","slow",0,"B","meme"),("sosed_marina","Соседка Марина","fast",1,"A","meme"),("sosed_borya","Сосед Боря","normal",1,"B","conflict"),("sosed_lyosha","Сосед Лёша","normal",2,"A","balanced"),("sosed_tanya","Соседка Таня","fast",0,"A","calm")]),
("продавцы",[("prod_zoya","Продавщица Зоя","slow",1,"B","conflict"),("prod_alla","Продавщица Алла","fast",1,"A","chaotic"),("prod_misha","Продавец Миша","normal",0,"B","balanced"),("prod_fatima","Продавщица Фатима","fast",0,"A","meme")]),
("врачи",[("vrach_olga","Врач Ольга","normal",0,"B","conflict"),("vrach_sergey","Врач Сергей","fast",2,"A","balanced"),("vrach_anna","Врач Анна","slow",0,"B","calm"),("vrach_kostya","Врач Костя","fast",1,"A","meme")]),
("учителя",[("uchitel_viktor","Учитель Виктор","fast",0,"A","meme"),("uchitel_anna","Учитель Анна","slow",0,"B","calm"),("uchitel_petr","Учитель Пётр","normal",1,"A","conflict"),("uchitel_olya","Учитель Оля","fast",0,"A","balanced")]),
("блогеры",[("bloger_vika","Блогер Вика","fast",0,"A","meme"),("bloger_zheka","Блогер Жека","fast",2,"A","chaotic"),("bloger_liza","Блогер Лиза","slow",0,"B","calm"),("bloger_maks","Блогер Макс","fast",1,"A","meme"),("bloger_dasha","Блогер Даша","normal",0,"B","balanced")]),
("таксисты",[("taxist_ahmed","Таксист Ахмед","normal",1,"B","balanced"),("taxist_sanya","Таксист Саня","fast",3,"A","chaotic"),("taxist_kostya","Таксист Костя","slow",1,"B","calm"),("taxist_ruslan","Таксист Руслан","fast",2,"A","meme")]),
("бизнесмены",[("biz_oleg","Бизнесмен Олег","slow",2,"B","conflict"),("biz_vlad","IT Влад","fast",0,"A","meme"),("biz_marina","Бизнес-леди Марина","fast",0,"A","meme"),("biz_artur","Бизнесмен Артур","normal",1,"B","balanced"),("biz_kseniya","Бизнес-леди Ксения","fast",0,"A","conflict")]),
("студенты",[("stud_kolya","Студент Коля","slow",2,"B","meme"),("stud_lera","Студентка Лера","fast",0,"A","balanced"),("stud_danil","Студент Данил","normal",1,"A","chaotic"),("stud_anya","Студентка Аня","fast",0,"B","calm")]),
("пенсионеры",[("pens_fedor","Пенсионер Фёдор","slow",0,"B","calm"),("pens_lidiya","Пенсионерка Лидия","normal",0,"B","calm"),("pens_arkady","Пенсионер Аркадий","normal",1,"A","meme"),("pens_zoya","Пенсионерка Зоя","slow",0,"B","balanced")]),
("чиновники",[("chin_boris","Чиновник Борис","slow",0,"B","conflict"),("chin_elena","Чиновница Елена","normal",0,"A","conflict"),("chin_gennady","Чиновник Геннадий","slow",1,"B","meme")]),
("фитнес",[("fit_mila","Фитнес Мила","fast",0,"A","chaotic"),("fit_stas","Фитнес Стас","fast",1,"A","meme"),("fit_yana","Фитнес Яна","normal",0,"B","balanced")]),
("кошатницы",[("kosh_marfa","Кошатница Марфа","slow",0,"B","calm"),("kosh_vera","Кошатница Вера","normal",0,"A","meme"),("kosh_galya","Кошатница Галя","slow",1,"B","balanced")]),
("экстремалы",[("extr_dima","Экстремал Дима","fast",2,"A","chaotic"),("extr_nika","Экстремалка Ника","fast",1,"A","meme")]),
]
HOOKS={"A":["aggressive finger point","slams table","shows phone","holds prop up","waves hands"],"B":["slow head turn","calm stare","raises eyebrow","crosses arms","adjusts glasses"]}
LAUGHS={"chaotic":"wheezing burst","meme":"snort-laugh","conflict":"grudging smirk","calm":"quiet chuckle","balanced":"warm laugh"}
chars=[]
for grp,members in G:
 for mid,name,pace,swear,role,compat in members:
  import hashlib
  h=HOOKS[role];lgh=LAUGHS[compat]
  chars.append({"id":mid,"name_ru":name,"group":grp,"tags":[grp,compat,pace],"appearance_ru":f"Персонаж {name}, типичный представитель группы «{grp}», выразительная внешность, детализированная текстура кожи","speech_style_ru":f"Характерная речь для {grp}, темп {pace}, уровень экспрессии {swear}/3","behavior_ru":f"Поведение: {compat}, роль {role} в диалоге","speech_pace":pace,"swear_level":swear,"role_default":role,"signature_words_ru":[name.split()[-1].lower(),"ну","да"],"prompt_tokens":{"character_en":f"Russian character {name}, {grp} archetype, expressive face, detailed skin microtexture, {pace} speech pace, {compat} energy"},"modifiers":{"hook_style":h[hash(mid)%len(h)],"laugh_style":lgh},"compatibility":compat})
out=os.path.join(os.path.dirname(os.path.dirname(__file__)),"app","data","characters.json")
os.makedirs(os.path.dirname(out),exist_ok=True)
with open(out,"w",encoding="utf-8") as f:
 json.dump(chars,f,ensure_ascii=False,indent=1)
print(f"Generated {len(chars)} characters -> {out}")
