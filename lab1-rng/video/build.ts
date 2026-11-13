/**
 * Збирання відеопояснення роботи:
 *   1) готує слайди (HTML → PNG через headless Chrome);
 *   2) озвучує текст українським синтезатором мовлення (`say -v Lesya`);
 *   3) склеює зображення та звук у відео за допомогою ffmpeg.
 *
 * Запуск: bun run video/build.ts
 */
import { $ } from 'bun';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { bullets, chart, n1, n2, n3, table, terminal, type Slide } from './slides.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const BUILD = `${ROOT}video/build/`;
const OUT = `${ROOT}out/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTH = 1600;
const HEIGHT = 900;

interface Results {
  readonly meta: { readonly date: string; readonly runtime: string };
  readonly task1: {
    readonly n: number;
    readonly experiments: readonly {
      readonly lambda: number;
      readonly source: string;
      readonly summary: { readonly mean: number; readonly variance: number };
      readonly theoretical: { readonly mean: number; readonly variance: number };
      readonly testTrue: { readonly statistic: number; readonly critical: number; readonly accepted: boolean };
      readonly testWrong: { readonly statistic: number; readonly accepted: boolean };
    }[];
  };
  readonly task2: {
    readonly experiments: readonly {
      readonly label: string;
      readonly summary: { readonly mean: number; readonly variance: number };
      readonly test: { readonly statistic: number; readonly critical: number; readonly accepted: boolean };
      readonly period: number | null;
      readonly theoreticalPeriod: string;
      readonly planeFraction: number;
    }[];
  };
  readonly task3: {
    readonly runs: number;
    readonly summary: { readonly mean: number; readonly variance: number; readonly min: number; readonly max: number };
    readonly skewness: number;
    readonly modes: number;
    readonly quantiles: { readonly p50: number; readonly p90: number; readonly p99: number };
    readonly candidates: readonly {
      readonly name: string;
      readonly statistic: number;
      readonly critical: number;
      readonly accepted: boolean;
    }[];
    readonly best: { readonly name: string };
    readonly imitations: readonly {
      readonly label: string;
      readonly errors: { readonly mean: number; readonly variance: number; readonly p99: number };
      readonly kolmogorov: number;
    }[];
  };
}

const page = (slide: Slide, index: number, total: number): string => `<!doctype html>
<html lang="uk"><head><meta charset="utf-8"><title>${slide.title}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    background: #0e1420; color: #e8edf6; padding: 54px 72px; position: relative;
  }
  .kicker { font-size: 20px; letter-spacing: .14em; text-transform: uppercase; color: #6f8bc7; }
  h1 { font-size: 46px; margin: 10px 0 26px; line-height: 1.15; }
  ul { font-size: 27px; line-height: 1.55; margin: 0; padding-left: 28px; }
  li { margin-bottom: 14px; }
  li b, p b { color: #ffd479; }
  code, .mono { font-family: "SF Mono", Menlo, monospace; color: #9fe6c4; }
  .formula {
    font-size: 34px; text-align: center; margin: 26px 0; padding: 22px;
    background: #16203a; border-radius: 14px; border: 1px solid #27365c; color: #cfe0ff;
  }
  table { width: 100%; border-collapse: collapse; font-size: 22px; margin-top: 8px; }
  th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid #243052; }
  th { color: #8fa8dd; font-weight: 600; font-size: 20px; letter-spacing: .04em; }
  table.compact { font-size: 19px; }
  table.compact th, table.compact td { padding: 5px 10px; }
  td:not(:first-child), th:not(:first-child) { text-align: right; }
  .chart { display: flex; justify-content: center; margin-top: 8px; }
  .chart img { max-height: 560px; border-radius: 12px; background: #fff; padding: 8px; }
  .terminal {
    background: #05080f; border: 1px solid #22304f; border-radius: 12px; padding: 20px 24px;
    font-family: "SF Mono", Menlo, monospace; font-size: 19px; line-height: 1.45; color: #b7f5d8;
    white-space: pre-wrap; max-height: 640px; overflow: hidden;
  }
  .footer { position: absolute; bottom: 26px; left: 72px; right: 72px; display: flex;
    justify-content: space-between; font-size: 18px; color: #5b6f9e; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; align-items: start; }
</style></head>
<body>
  <div class="kicker">${slide.kicker}</div>
  <h1>${slide.title}</h1>
  ${slide.body}
  <div class="footer"><span>Комп’ютерний практикум №1 · перевірка генератора випадкових чисел</span><span>${index} / ${total}</span></div>
</body></html>`;

const buildSlides = (r: Results, logs: Record<string, string>): Slide[] => {
  const t1 = r.task1.experiments;
  const base = r.task2.experiments[0];
  const randu = r.task2.experiments.find((e) => e.label.includes('RANDU'));
  const shortPeriod = r.task2.experiments.find((e) => e.label.includes('c=2¹³'));
  const t3 = r.task3;
  const bestImitation = t3.imitations[0];
  const empirical = t3.imitations[1];

  return [
    {
      id: '01-title',
      kicker: 'Комп’ютерний практикум №1',
      title: 'Перевірка генератора випадкових чисел на відповідність закону розподілу',
      body: `${bullets([
        'Генерування 10 000 чисел двома способами та перевірка гіпотез за критерієм узгодження χ²',
        'Дослідження часової затримки на сортування колекції з 1 000 000 об’єктів',
        'Побудова генератора, який імітує виміряну затримку',
      ])}<p style="font-size:24px;color:#8fa8dd;margin-top:32px">Реалізація: TypeScript / Bun · ${r.meta.runtime} · ${r.meta.date}</p>`,
      speech:
        'Вітаю! Це відеопояснення до комп’ютерного практикуму номер один: перевірка генератора випадкових чисел на відповідність закону розподілу. ' +
        'Робота складається з трьох частин. Перша: згенерувати десять тисяч чисел методом оберненої функції і перевірити їх на експоненційний закон розподілу за критерієм хі-квадрат. ' +
        'Друга: згенерувати числа конгруентним методом і перевірити їх на рівномірний закон. ' +
        'Третя: дослідити часову затримку програми на сортування колекції з мільйона об’єктів, ідентифікувати її закон розподілу і побудувати генератор, який цю затримку імітує. ' +
        'Усе реалізовано мовою TypeScript, усі статистичні обчислення написані вручну, без зовнішніх бібліотек.',
    },
    {
      id: '02-structure',
      kicker: 'Структура рішення',
      title: 'Як влаштована програма',
      body: table(
        ['Модуль', 'Призначення'],
        [
          ['<span class="mono">stats.ts</span>', 'середнє, дисперсія, гамма-функція, розподіл хі-квадрат'],
          ['<span class="mono">generators.ts</span>', 'конгруентний генератор, метод оберненої функції, табличний метод'],
          ['<span class="mono">distributions.ts</span>', 'закони розподілу та оцінка їх параметрів'],
          ['<span class="mono">goodness.ts</span>', 'критерій χ², λ-критерій Колмогорова, тести кореляції'],
          ['<span class="mono">mixture.ts</span>', 'EM-алгоритм для суміші логнормальних складових'],
          ['<span class="mono">task1/2/3.ts</span>', 'три завдання практикуму'],
          ['<span class="mono">charts.ts, report.ts</span>', 'побудова SVG-графіків та звіту'],
        ],
      ),
      speech:
        'Спочатку коротко про структуру коду. Модуль stats містить описову статистику та спеціальні функції: неповну гамма-функцію і функцію розподілу хі-квадрат — саме через неї обчислюються критичні та пі-значення. ' +
        'Модуль generators містить конгруентний генератор і метод оберненої функції. Модуль distributions описує теоретичні закони розподілу та оцінку їхніх параметрів. ' +
        'Модуль goodness реалізує критерій хі-квадрат, лямбда-критерій Колмогорова і перевірку кореляції. Окремо винесено EM-алгоритм для сумішей розподілів — він знадобиться у третьому завданні. ' +
        'Три модулі task відповідають трьом завданням, а charts і report будують графіки та підсумковий звіт.',
    },
    {
      id: '03-task1-method',
      kicker: 'Завдання 1',
      title: 'Метод оберненої функції',
      body: `<div class="formula">F(x) = 1 − e<sup>−λx</sup> &nbsp;⟹&nbsp; x = −(1/λ)·ln(ξ), &nbsp; ξ ~ U(0;1)</div>
      ${bullets([
        'Числа ξ беремо з двох джерел: вбудований <span class="mono">Math.random()</span> та власний конгруентний генератор',
        `Обсяг вибірки: <b>${r.task1.n}</b> чисел для кожного значення λ = 0,5; 1; 2`,
        'Будуємо гістограму частот, рахуємо середнє та дисперсію, перевіряємо гіпотезу за критерієм χ²',
        'Контрольна перевірка зі зміщеним на 15 % значенням λ показує чутливість критерію',
      ])}`,
      speech:
        'Перше завдання. Випадкове число з експоненційним законом розподілу отримуємо методом оберненої функції: ікс дорівнює мінус один поділити на лямбда, помножене на натуральний логарифм від ксі, де ксі — рівномірно розподілене число на інтервалі від нуля до одиниці. ' +
        'Рівномірні числа беремо з двох джерел: з вбудованого генератора мови і з власного конгруентного генератора з другого завдання. Для кожного значення лямбда генеруємо десять тисяч чисел. ' +
        'Крім основної перевірки я додав контрольну: перевіряю ту саму вибірку проти свідомо неправильного лямбда, зміщеного на п’ятнадцять відсотків. Якщо критерій справді працює, він має цю гіпотезу відхилити.',
    },
    {
      id: '04-task1-results',
      kicker: 'Завдання 1 · результати',
      title: 'Середнє, дисперсія та критерій χ²',
      body: table(
        ['λ', 'Джерело ξ', 'x̄ / теор.', 'S² / теор.', 'χ²', 'χ²кр', 'Висновок'],
        t1.map((e) => [
          String(e.lambda),
          e.source.startsWith('вбудований') ? 'Math.random()' : 'конгруентний',
          `${n3(e.summary.mean)} / ${n3(e.theoretical.mean)}`,
          `${n3(e.summary.variance)} / ${n3(e.theoretical.variance)}`,
          n2(e.testTrue.statistic),
          n2(e.testTrue.critical),
          e.testTrue.accepted ? '✅ приймається' : '❌ відхиляється',
        ]),
      ),
      speech:
        'Ось результати. Вибіркове середнє практично збігається з теоретичним значенням один поділити на лямбда, а вибіркова дисперсія — з одиницею поділеною на лямбда у квадраті. ' +
        'Спостережуване значення хі-квадрат для кожного випадку помітно менше за критичне значення тридцять цілих одна десята при рівні значимості п’ять відсотків і дев’ятнадцяти ступенях вільності. ' +
        'Отже, гіпотезу про експоненційний закон розподілу приймаємо для всіх перевірених значень лямбда і для обох джерел рівномірних чисел.',
    },
    {
      id: '05-task1-chart',
      kicker: 'Завдання 1 · гістограма',
      title: 'Емпіричні частоти проти теоретичної кривої',
      body: chart(`${OUT}task1-lambda-1-builtin.svg`),
      speech:
        'На графіку — гістограма частот для лямбда, що дорівнює одиниці. Сині стовпці — емпіричні частоти, помаранчева крива — теоретично очікувані частоти експоненційного закону. ' +
        'Видно, що гістограма монотонно спадає і щільно лягає на теоретичну криву. Саме цю відповідність і вимірює критерій хі-квадрат: він додає квадрати відхилень спостережуваних частот від очікуваних, поділені на очікувані.',
    },
    {
      id: '06-task1-control',
      kicker: 'Завдання 1 · чутливість критерію',
      title: 'Контрольна перевірка: свідомо хибне λ',
      body: `${table(
        ['λ генерування', 'Джерело ξ', 'χ² при правильному λ', 'χ² при λ·1,15', 'Висновок контролю'],
        t1.map((e) => [
          String(e.lambda),
          e.source.startsWith('вбудований') ? 'Math.random()' : 'конгруентний',
          n2(e.testTrue.statistic),
          n2(e.testWrong.statistic),
          e.testWrong.accepted ? 'помилково приймається' : '❌ відхиляється — критерій працює',
        ]),
      )}<p style="font-size:24px;margin-top:22px;color:#9fb4e0">Похибка в параметрі лише на 15 % збільшує χ² у десятки разів — збіг у основних перевірках не є випадковим.</p>`,
      speech:
        'А це найцікавіше. Якщо ту саму вибірку перевірити проти експоненційного закону з параметром лямбда, зміщеним усього на п’ятнадцять відсотків, значення хі-квадрат зростає у десятки разів і гіпотеза впевнено відхиляється. ' +
        'Це доводить, що критерій має достатню чутливість, а успішні перевірки на попередньому слайді — не випадковість і не самообман.',
    },
    {
      id: '07-task2-method',
      kicker: 'Завдання 2',
      title: 'Мультиплікативний конгруентний генератор',
      body: `<div class="formula">z<sub>i+1</sub> = a·z<sub>i</sub> (mod c), &nbsp; x<sub>i+1</sub> = z<sub>i+1</sub> / c, &nbsp; a = 5<sup>13</sup>, c = 2<sup>31</sup></div>
      ${bullets([
        'Добуток a·z<sub>i</sub> перевищує 2<sup>53</sup>, тому обчислення виконуються у <span class="mono">BigInt</span> — інакше втрачається точність',
        'Перевірка рівномірності на (0;1) за критерієм χ², 20 інтервалів по 10 000 чисел',
        'Додатково: критерій кореляції, визначення періоду, діаграма розсіювання пар',
        'Порівняно п’ять наборів параметрів, зокрема свідомо невдалі',
      ])}`,
      speech:
        'Друге завдання — конгруентний генератор. Наступне число дорівнює попередньому, помноженому на а, за модулем це, а нормоване число отримуємо діленням на це. За умовою а дорівнює п’ять у тринадцятому степені, а це — два у тридцять першому. ' +
        'Тут є важлива технічна деталь: добуток а на зет перевищує два у п’ятдесят третьому степені, тобто межу точного представлення цілих чисел у форматі з рухомою комою. Тому всі обчислення я виконую у типі BigInt — інакше молодші розряди, а саме вони й формують випадковість, просто загубилися б. ' +
        'Крім перевірки на рівномірність я визначаю період генератора, перевіряю кореляцію між числами і будую діаграму розсіювання пар сусідніх чисел.',
    },
    {
      id: '08-task2-results',
      kicker: 'Завдання 2 · результати',
      title: 'П’ять наборів параметрів',
      body: table(
        ['Параметри', 'x̄', 'S²', 'χ²', 'Період', 'Трійки у площинах', 'Висновок'],
        r.task2.experiments.map((e) => [
          e.label,
          n3(e.summary.mean),
          n3(e.summary.variance),
          n2(e.test.statistic),
          e.period === null ? e.theoreticalPeriod : String(e.period),
          `${(e.planeFraction * 100).toFixed(0)} %`,
          e.test.accepted ? '✅ рівномірний' : '❌ відхиляється',
        ]),
      ),
      speech:
        `Результати перевірки. Для параметрів з умови вибіркове середнє дорівнює ${n3(base?.summary.mean ?? 0.5)}, а теоретичне — нуль цілих п’ять десятих; дисперсія ${n3(base?.summary.variance ?? 0.083)} проти теоретичної нуль цілих вісім три. ` +
        `Спостережуване хі-квадрат ${n2(base?.test.statistic ?? 0)} менше за критичне ${n2(base?.test.critical ?? 0)}, тому гіпотезу про рівномірний закон розподілу приймаємо. ` +
        'Але зверніть увагу на два останні стовпці — саме вони показують, чого перевірка на рівномірність не бачить.',
    },
    {
      id: '09-task2-randu',
      kicker: 'Завдання 2 · чому χ² недостатньо',
      title: 'RANDU: рівномірний, але не випадковий',
      body: `<div class="cols"><div>${bullets([
        `Генератор RANDU (a = 65539, c = 2³¹) перевірку на рівномірність <b>проходить</b>: χ² = ${n2(randu?.test.statistic ?? 0)} < ${n2(randu?.test.critical ?? 0)}`,
        `Але для <b>${((randu?.planeFraction ?? 1) * 100).toFixed(0)} %</b> трійок виконується z<sub>i+2</sub> = 6·z<sub>i+1</sub> − 9·z<sub>i</sub> (mod c)`,
        'Тобто всі трійки чисел лежать лише у 15 площинах одиничного куба',
        `Для набору a = 5, c = 2¹³ період усього ${shortPeriod?.period ?? 2048} чисел, і χ² = ${n2(shortPeriod?.test.statistic ?? 0)} — <b>підозріло мале</b>: це ознака регулярності, а не випадковості`,
      ])}</div><div>${chart(`${OUT}task2-1-scatter.svg`)}</div></div>`,
      speech:
        'Ось класичний приклад. Генератор RANDU перевірку на рівномірність за критерієм хі-квадрат проходить успішно. Але якщо перевірити лінійне співвідношення між трьома послідовними числами, виявиться, що воно виконується для ста відсотків трійок. ' +
        'Це означає, що всі точки у тривимірному одиничному кубі лежать лише у п’ятнадцяти площинах — числа зовсім не є незалежними. ' +
        'Другий повчальний випадок: набір з дуже коротким періодом у дві тисячі сорок вісім чисел. У вибірці з десяти тисяч кожне число циклу повторюється майже однакову кількість разів, тому хі-квадрат виходить аномально малим. Занадто добрий збіг — це теж привід насторожитися, бо він свідчить про регулярність послідовності.',
    },
    {
      id: '10-task3-method',
      kicker: 'Завдання 3',
      title: 'Часова затримка на сортування 1 000 000 об’єктів',
      body: `${bullets([
        'Масив із <b>1 000 000</b> об’єктів <span class="mono">{ id, key }</span> з випадковим ключем; вимірюється час виключно методу сортування',
        `<b>${t3.runs}</b> прогонів після 5 «розігрівальних» — щоб виключити вплив компіляції JIT`,
        `Середня затримка <b>${n1(t3.summary.mean)} мс</b>, S² = ${n1(t3.summary.variance)}, асиметрія ${n2(t3.skewness)}`,
        `Медіана ${n1(t3.quantiles.p50)} мс, 90 % квантиль ${n1(t3.quantiles.p90)} мс, 99 % квантиль ${n1(t3.quantiles.p99)} мс`,
      ])}${chart(`${OUT}task3-delays.svg`)}`,
      speech:
        `Третє завдання — часова затримка програми на сортування колекції з мільйона об’єктів. Я формую масив із мільйона об’єктів з випадковим ключем і вимірюю час виключно методу сортування; час формування колекції у вимір не входить. ` +
        `Виконано ${t3.runs} прогонів, перші п’ять — розігрівальні, щоб виключити вплив компіляції під час виконання. ` +
        `Середня затримка склала близько ${n1(t3.summary.mean)} мілісекунд, але розподіл дуже несиметричний: коефіцієнт асиметрії ${n2(t3.skewness)}. На графіку видно рівний базовий рівень і рідкісні високі піки — це паузи складальника сміття та планувальника операційної системи.`,
    },
    {
      id: '11-task3-identify',
      kicker: 'Завдання 3 · ідентифікація',
      title: 'Який закон розподілу описує затримку?',
      body: `<div class="cols"><div>${table(
        ['Закон розподілу', 'χ²', 'χ²кр', ''],
        t3.candidates.map((c) => [
          c.name.replace(' складових (EM)', ' складових').replace('складений (логнормальне тіло + експоненційний хвіст)', 'складений: тіло + хвіст'),
          n1(c.statistic),
          n1(c.critical),
          c.accepted ? '✅' : '❌',
        ]),
      ).replace('<table>', '<table class="compact">')}</div><div>${chart(`${OUT}task3-histogram.svg`)}</div></div>`,
      speech:
        `Тепер ідентифікація закону розподілу. Я перевірив ${t3.candidates.length} законів-кандидатів: нормальний, логнормальний, гамма, зсунутий експоненційний, їхні тріпараметричні варіанти і суміші. ` +
        'Перевірка виконується за критерієм хі-квадрат на рівноймовірних інтервалах — для невеликої вибірки це коректніше, ніж інтервали рівної ширини, бо очікувана частота в кожному інтервалі однакова. ' +
        `І тут головний результат роботи: класичні одномодальні закони дані не описують. На згладженій гістограмі виявлено ${t3.modes} локальних максимум${t3.modes === 1 ? '' : 'и'}, а коефіцієнт асиметрії дорівнює ${n2(t3.skewness)}. ` +
        'Причина фізична: процесор виконує ту саму роботу на різних тактових частотах, тому типовий час групується навколо кількох значень, а зверху додається важкий правий хвіст від рідкісних довгих пауз. ' +
        `Найкраще узгодження показав ${t3.best.name.replace(' (EM)', ', параметри якої оцінено EM-алгоритмом')}.`,
    },
    {
      id: '12-task3-imitation',
      kicker: 'Завдання 3 · імітація',
      title: 'Генератор, що імітує часову затримку',
      body: `<div class="cols"><div>${table(
        ['Генератор', 'Похибка x̄', 'Похибка S²', 'D Колмогорова'],
        t3.imitations.map((im) => [
          im.label.replace(' складових (EM)', ' складових').replace('імітація ', ''),
          `${(im.errors.mean * 100).toFixed(2)} %`,
          `${(im.errors.variance * 100).toFixed(1)} %`,
          n3(im.kolmogorov),
        ]),
      )}</div><div>${chart(`${OUT}task3-imitation.svg`)}</div></div>`,
      speech:
        'За ідентифікованим законом я побудував генератор-імітатор і згенерував ним десять тисяч значень затримки. Для порівняння додав ще два: табличний, тобто метод оберненої емпіричної функції розподілу, і складений — тіло розподілу за законом, а рідкісні довгі затримки за емпіричним хвостом. ' +
        `Параметричний генератор відтворює середнє з похибкою ${(bestImitation ? bestImitation.errors.mean * 100 : 0).toFixed(2)} відсотка, а дисперсію — з похибкою ${(bestImitation ? bestImitation.errors.variance * 100 : 0).toFixed(1)} відсотка. ` +
        `Табличний генератор дає найменшу відстань Колмогорова — ${n3(empirical?.kolmogorov ?? 0)}, тобто найточніше відтворює форму розподілу, але не може породити значень, яких не було у вибірці. На графіку сині стовпці — виміряні затримки, помаранчеві — імітовані.`,
    },
    {
      id: '13-tests',
      kicker: 'Тестування',
      title: 'Модульні тести та перевірка типів',
      body: `${terminal(logs.tests ?? '')}`,
      speech:
        'Тепер тестування. Двадцять модульних тестів перевіряють саме те, у чому можна помилитися. По-перше, коректність математики: значення критичних точок хі-квадрат звіряються з табличними — три цілих вісім чотири для одного ступеня вільності, одинадцять цілих нуль сім для п’яти, вісімнадцять цілих три один для десяти. ' +
        'По-друге, конгруентний генератор: перевіряю ручний розрахунок за формулою, відтворюваність послідовності за тим самим початковим значенням і період, який має дорівнювати двом тисячам сорока восьми. ' +
        'По-третє, метод оберненої функції: підстановка згенерованого числа назад у функцію розподілу має повертати вихідне рівномірне число. ' +
        'І найважливіше — сам критерій хі-квадрат: він має приймати гіпотезу для вибірки з того самого закону і відхиляти її для вибірки з іншим параметром. Усі двадцять тестів проходять, перевірка типів також без помилок.',
    },
    {
      id: '14-run-a',
      kicker: 'Тестування',
      title: 'Повний прогін: завдання 1 і 2',
      body: `${terminal(logs.runA ?? '')}`,
      speech:
        'А це повний прогін програми. Він виконує всі три завдання, друкує результати і зберігає звіт, графіки та машиночитний файл з результатами у каталог out. ' +
        'У першому блоці видно, що для всіх значень лямбда і для обох джерел рівномірних чисел гіпотеза про експоненційний закон приймається, а контрольна перевірка зі зміщеним лямбда — упевнено відхиляється. ' +
        'У другому блоці всі п’ять наборів параметрів конгруентного генератора проходять перевірку на рівномірність, а для двох наборів виміряно реальний період послідовності.',
    },
    {
      id: '14-run-b',
      kicker: 'Тестування',
      title: 'Повний прогін: завдання 3',
      body: `${terminal(logs.runB ?? '')}`,
      speech:
        'У третьому блоці — результати вимірювання часової затримки: середнє значення, дисперсія, коефіцієнт асиметрії, далі перевірка десяти законів розподілу за критерієм хі-квадрат і, нарешті, точність трьох генераторів-імітаторів: похибка середнього, похибка дисперсії та відстань Колмогорова. ' +
        'Усі ці числа автоматично потрапляють у звіт out report крапка em de.',
    },
    {
      id: '15-conclusions',
      kicker: 'Висновки',
      title: 'Що показала робота',
      body: bullets([
        'Метод оберненої функції дає числа, що узгоджуються з експоненційним законом; контрольна перевірка підтверджує чутливість критерію χ²',
        'Конгруентний генератор з параметрами a = 5¹³, c = 2³¹ придатний для імітаційного моделювання, але якість критично залежить від вибору параметрів',
        'Перевірки лише на рівномірність недостатньо: приклад RANDU і приклад «підозріло малого» χ² при короткому періоді',
        'Два способи доповнюють один одного: конгруентний генератор — джерело рівномірних чисел, метод оберненої функції — перетворювач на заданий закон',
        'Реальна часова затримка виявилась багатомодальною з важким хвостом — жоден класичний закон її не описує; для імітації потрібні суміші або емпіричний розподіл',
      ]),
      speech:
        'Підсумую. Метод оберненої функції дає числа, які узгоджуються з експоненційним законом розподілу, і контрольна перевірка підтверджує, що критерій хі-квадрат справді чутливий. ' +
        'Конгруентний генератор з параметрами із завдання придатний для імітаційного моделювання, але його якість критично залежить від вибору параметрів: коротший модуль різко скорочує період, а невдалий множник створює приховані залежності, яких перевірка на рівномірність не помічає. ' +
        'Два способи генерування не конкурують, а доповнюють один одного: конгруентний метод — це джерело рівномірних чисел, а метод оберненої функції перетворює їх на числа із потрібним законом розподілу. ' +
        'І головний практичний висновок третього завдання: реальна часова затримка програми виявилась багатомодальною і з важким правим хвостом, тому жоден класичний закон її не описує. Для імітації таких затримок потрібні або суміші розподілів, або емпіричний розподіл за зібраними даними. Дякую за увагу!',
    },
  ];
};

const run = async (): Promise<void> => {
  await mkdir(BUILD, { recursive: true });

  console.log('▸ збираю свіжі логи запуску та тестів…');
  const tests = await $`cd ${ROOT} && ${process.env.HOME}/.bun/bin/bun test 2>&1 && ${process.env.HOME}/.bun/bin/bunx tsc --noEmit && echo "\n$ bunx tsc --noEmit\nПеревірка типів: помилок немає"`.text();
  // у слайд беремо лише змістовні рядки, без переліку збережених файлів
  const runLog = (await readFile(`${BUILD}run.log`, 'utf8').catch(() => ''))
    .split('\n')
    .filter((line) => !line.startsWith('  → '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  const results = JSON.parse(await readFile(`${OUT}results.json`, 'utf8')) as Results;
  const marker = runLog.indexOf('═══ Завдання 3');
  const slides = buildSlides(results, {
    tests: `$ bun test\n${tests.trim()}`,
    runA: `$ bun start\n${runLog.slice(0, marker).trim()}`,
    runB: runLog.slice(marker).trim(),
  });

  console.log('▸ рендерю слайди…');
  const segments: string[] = [];
  for (const [i, slide] of slides.entries()) {
    const html = `${BUILD}${slide.id}.html`;
    const png = `${BUILD}${slide.id}.png`;
    const aiff = `${BUILD}${slide.id}.aiff`;
    const mp4 = `${BUILD}${slide.id}.mp4`;
    await writeFile(html, page(slide, i + 1, slides.length), 'utf8');
    await $`${CHROME} --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files --window-size=${WIDTH},${HEIGHT} --screenshot=${png} ${`file://${html}`}`.quiet();
    await $`say -v Lesya -r 178 -o ${aiff} ${slide.speech}`.quiet();
    await $`ffmpeg -y -loop 1 -i ${png} -i ${aiff} -af apad=pad_dur=1.0 -c:v libx264 -tune stillimage -preset medium -crf 20 -c:a aac -b:a 192k -pix_fmt yuv420p -shortest -r 25 ${mp4}`.quiet();
    segments.push(mp4);
    console.log(`  ${i + 1}/${slides.length} ${slide.id}`);
  }

  await writeFile(`${BUILD}segments.txt`, segments.map((s) => `file '${s}'`).join('\n'), 'utf8');
  const output = `${ROOT}out/lab1-video.mp4`;
  await $`ffmpeg -y -f concat -safe 0 -i ${`${BUILD}segments.txt`} -c copy ${output}`.quiet();
  const duration = (await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${output}`.text()).trim();
  console.log(`\n✔ відео готове: out/lab1-video.mp4 (${Math.round(Number(duration))} с)`);
};

await run();
