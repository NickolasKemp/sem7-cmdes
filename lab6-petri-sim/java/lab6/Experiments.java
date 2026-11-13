package lab6;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.ToIntFunction;
import lab6.NetBuilder.Model;
import lab6.Nets.Conveyor;
import lab6.Nets.Stock;
import lab6.Nets.Web;
import ua.stetsenkoinna.petriobj.PetriNet;
import ua.stetsenkoinna.petriobj.PetriP;
import ua.stetsenkoinna.petriobj.PetriT;

/** Досліди з трьома моделями: базові прогони, верифікація зміною параметрів, перевірка інваріантів і рівнянь станів. */
final class Experiments {
    private Experiments() {}

    private static final String[] SERVERS = {"1", "2"};

    static void run(Path out) throws Exception {
        Files.createDirectories(out);
        Map<String, Object> results = new LinkedHashMap<>();
        results.put("conveyor", conveyor());
        results.put("stock", stock());
        results.put("web", web());
        Files.writeString(out.resolve("results.json"), Stats.json(results), StandardCharsets.UTF_8);
    }

    private static int marks(PetriNet net, String... places) {
        int sum = 0;
        for (PetriP p : net.getListP()) {
            for (String name : places) {
                if (p.getName().equals(name)) {
                    sum += p.getMark();
                }
            }
        }
        return sum;
    }

    private static int buffers(PetriNet net, String... transitions) {
        int sum = 0;
        for (PetriT t : net.getListT()) {
            for (String name : transitions) {
                if (t.getName().equals(name)) {
                    sum += t.getBuffer();
                }
            }
        }
        return sum;
    }

    /** Прогони однієї моделі: оцінки характеристик і сумарна кількість порушень інваріантів та рівнянь станів. */
    private static final class Series {
        final Map<String, Object> estimates;
        final long violations;
        final long mismatches;
        final long events;

        Series(Map<String, Object> estimates, long violations, long mismatches, long events) {
            this.estimates = estimates;
            this.violations = violations;
            this.mismatches = mismatches;
            this.events = events;
        }

        Map<String, Object> checks() {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("events", events);
            c.put("invariantViolations", violations);
            c.put("stateEquationMismatches", mismatches);
            return c;
        }
    }

    private interface Measure {
        Map<String, Double> of(Model m, Sim.Result r);
    }

    private static Series series(int runs, java.util.function.Supplier<Model> model, Sim.Options options, Measure measure) {
        long[] totals = new long[3];
        Map<String, Object> estimates = Stats.replicate(runs, () -> {
            Model m = model.get();
            Sim.Result r = Sim.run(m.net(), options);
            totals[0] += r.violations.values().stream().mapToInt(Integer::intValue).sum();
            totals[1] += Sim.stateEquationMismatches(r);
            totals[2] += r.events;
            return measure.of(m, r);
        });
        return new Series(estimates, totals[0], totals[1], totals[2]);
    }

    // ─────────────────────────────── Задача 1

    private static final double CONVEYOR_TIME = 10_000;
    private static final double CONVEYOR_WARMUP = 1_000;
    private static final int CONVEYOR_RUNS = 20;

    private static String[] numbered(String prefix, int from, int to) {
        String[] names = new String[to - from + 1];
        for (int i = from; i <= to; i++) {
            names[i - from] = prefix + i;
        }
        return names;
    }

    private static final String[] AT = numbered("Біля", 1, Nets.DEVICES);
    private static final String[] SERVE = numbered("Обробка", 1, Nets.DEVICES);
    private static final String[] MOVE = {"Рух12", "Рух23", "Рух34", "Рух45", "Повернення"};

    private static Series conveyorSeries(Conveyor c, int runs) {
        Map<String, ToIntFunction<PetriNet>> gauges = new LinkedHashMap<>();
        gauges.put("inSystem", net -> marks(net, AT) + buffers(net, SERVE) + buffers(net, MOVE));
        gauges.put("busy", net -> buffers(net, SERVE));
        Map<String, ToIntFunction<PetriNet>> invariants = new LinkedHashMap<>();
        // пристрій або вільний, або обробляє одну деталь; генератор завжди один
        for (int i = 1; i <= Nets.DEVICES; i++) {
            String free = "Вільний" + i;
            String serve = "Обробка" + i;
            invariants.put("пристрій " + i, net -> marks(net, free) + buffers(net, serve));
        }
        invariants.put("генератор", net -> marks(net, "Генератор") + buffers(net, "Надходження"));
        Sim.Options options = new Sim.Options(CONVEYOR_TIME, CONVEYOR_WARMUP).gauges(gauges).invariants(invariants);
        return series(runs, () -> Nets.conveyor(c), options, (m, r) -> {
            Map<String, Double> v = new LinkedHashMap<>();
            double served = 0;
            for (String s : SERVE) {
                served += r.fired(m.t(s));
            }
            double throughput = served / r.span;
            v.put("arrivals", r.rate(m.t("Надходження")));
            v.put("throughput", throughput);
            v.put("inSystem", r.gauge("inSystem"));
            v.put("sojourn", r.gauge("inSystem") / throughput);
            v.put("busy", r.gauge("busy"));
            v.put("busyMax", (double) r.gauges.get("busy").max());
            v.put("returns", r.fired(m.t("Повернення")) / served);
            for (int i = 1; i <= Nets.DEVICES; i++) {
                v.put("load" + i, r.busy(m.t("Обробка" + i)));
            }
            for (int i = 1; i <= Nets.DEVICES; i++) {
                v.put("share" + i, r.fired(m.t("Обробка" + i)) / served);
            }
            for (int k = 0; k <= Nets.DEVICES; k++) {
                v.put("busy" + k, r.share("busy", k));
            }
            return v;
        });
    }

    private static Map<String, Object> variant(String label, Series s) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("label", label);
        row.put("result", s.estimates);
        return row;
    }

    private static Map<String, Object> conveyor() {
        Conveyor b = Conveyor.BASE;
        Series base = conveyorSeries(b, CONVEYOR_RUNS);
        List<Object> variants = new ArrayList<>();
        variants.add(variant("базовий", base));
        variants.add(variant("надходження кожні 0,5 хв", conveyorSeries(new Conveyor(0.5, b.service(), b.transfer(), b.back()), 5)));
        variants.add(variant("обробка exp(0,5)", conveyorSeries(new Conveyor(b.arrival(), 0.5, b.transfer(), b.back()), 5)));
        variants.add(variant("обробка exp(1,2)", conveyorSeries(new Conveyor(b.arrival(), 1.2, b.transfer(), b.back()), 5)));
        variants.add(variant("рух між пристроями 2 хв", conveyorSeries(new Conveyor(b.arrival(), b.service(), 2, b.back()), 5)));
        variants.add(variant("повернення 10 хв", conveyorSeries(new Conveyor(b.arrival(), b.service(), b.transfer(), 10), 5)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("run", Map.of("time", CONVEYOR_TIME, "warmup", CONVEYOR_WARMUP, "runs", CONVEYOR_RUNS));
        out.put("base", base.estimates);
        out.put("checks", base.checks());
        out.put("variants", variants);
        return out;
    }

    // ─────────────────────────────── Задача 2

    private static final double STOCK_TIME = 520;
    private static final int STOCK_RUNS = 30;
    private static final double TRACE_WEEKS = 104;

    private static int position(PetriNet net) {
        return marks(net, "Запас", "ВДорозі") + buffers(net, "Доставка") - marks(net, "Борг");
    }

    private static Series stockSeries(Stock s, int runs) {
        Map<String, ToIntFunction<PetriNet>> gauges = new LinkedHashMap<>();
        gauges.put("stock", net -> marks(net, "Запас"));
        gauges.put("position", Experiments::position);
        Map<String, ToIntFunction<PetriNet>> invariants = new LinkedHashMap<>();
        // позиція «Нестача» доповнює поточний стан запасу до контрольного рівня; у миттєвих переходах маркер не губиться
        invariants.put("поточний стан + нестача", net -> position(net) + marks(net, "Нестача") + buffers(net, "Продаж", "Дозамовлення"));
        invariants.put("таймер", net -> marks(net, "Таймер") + buffers(net, "Контроль"));
        Sim.Options options = new Sim.Options(STOCK_TIME, 0).gauges(gauges).invariants(invariants);
        return series(runs, () -> Nets.stock(s), options, (m, r) -> {
            Map<String, Double> v = new LinkedHashMap<>();
            double lost = r.fired(m.t("Відмова"));
            double demand = r.fired(m.t("Попит"));
            double orders = r.fired(m.t("Кінець"));
            v.put("stock", r.place(m.p("Запас")));
            v.put("backlog", r.place(m.p("Борг")));
            v.put("lost", lost);
            v.put("lostPerYear", lost / r.span * 52);
            v.put("betweenLost", r.span / lost);
            v.put("lostShare", lost / demand);
            v.put("backorderShare", r.fired(m.t("Очікування")) / demand);
            v.put("orders", orders / r.span * 52);
            v.put("orderSize", r.fired(m.t("Дозамовлення")) / orders);
            v.put("stockouts", r.share("stock", 0));
            v.put("positionMax", (double) r.gauges.get("position").max());
            return v;
        });
    }

    private static Map<String, Object> stock() {
        Stock b = Stock.BASE;
        Series base = stockSeries(b, STOCK_RUNS);
        List<Object> variants = new ArrayList<>();
        variants.add(variant("базовий", base));
        variants.add(variant("попит exp(0,4)", stockSeries(new Stock(0.4, b.lost(), b.review(), b.level(), b.reorder(), b.lead()), 10)));
        variants.add(variant("точка замовлення 36", stockSeries(new Stock(b.demand(), b.lost(), b.review(), b.level(), 36, b.lead()), 10)));
        variants.add(variant("перегляд кожні 2 тижні", stockSeries(new Stock(b.demand(), b.lost(), 2, b.level(), b.reorder(), b.lead()), 10)));
        variants.add(variant("доставка 1 тиждень", stockSeries(new Stock(b.demand(), b.lost(), b.review(), b.level(), b.reorder(), 1), 10)));
        variants.add(variant("ідуть 50 % покупців", stockSeries(new Stock(b.demand(), 0.5, b.review(), b.level(), b.reorder(), b.lead()), 10)));

        List<Object> trace = new ArrayList<>();
        Model m = Nets.stock(b);
        Sim.run(m.net(), new Sim.Options(TRACE_WEEKS, 0).tracer((t, net) -> trace.add(List.of(t, marks(net, "Запас"), position(net)))));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("run", Map.of("time", STOCK_TIME, "runs", STOCK_RUNS, "traceWeeks", TRACE_WEEKS));
        out.put("base", base.estimates);
        out.put("checks", base.checks());
        out.put("variants", variants);
        out.put("trace", trace);
        return out;
    }

    // ─────────────────────────────── Задача 3

    private static final double WEB_TIME = 200_000;
    private static final double WEB_WARMUP = 20_000;
    private static final int WEB_RUNS = 10;
    private static final double[] WEB_ARRIVALS = {4, 3, 2.5, 2, 1.8, 1.6, 1.5, 1.4, 1.3, 1.2, 1};

    private static String[] stages(String n) {
        return new String[] {"Черга" + n, "Готовий" + n, "Обчислено" + n, "Збережено" + n};
    }

    private static String[] work(String n) {
        return new String[] {"Прийняти" + n, "Обчислення" + n, "Запис" + n, "Відповідь" + n};
    }

    private static Series webSeries(Web w, int runs, double time, double warmup) {
        Map<String, ToIntFunction<PetriNet>> invariants = new LinkedHashMap<>();
        Nets.Server[] servers = {w.main(), w.aux()};
        for (String n : SERVERS) {
            // потік або в пулі, або веде запит від прийняття до відповіді; ядро або вільне, або обчислює
            invariants.put("потоки " + n, net -> marks(net, "Потоки" + n, "Готовий" + n, "Обчислено" + n, "Збережено" + n)
                    + buffers(net, "Прийняти" + n, "Обчислення" + n, "Запис" + n, "Відповідь" + n));
            invariants.put("ядра " + n, net -> marks(net, "Ядра" + n) + buffers(net, "Обчислення" + n));
        }
        invariants.put("з’єднання БД", net -> marks(net, "БД") + buffers(net, "Запис1", "Запис2"));
        invariants.put("місця в черзі", net -> marks(net, "Місця", "Черга1", "Черга2") + buffers(net, "ДоГоловного", "ДоДопоміжного", "Прийняти1", "Прийняти2"));
        Sim.Options options = new Sim.Options(time, warmup).invariants(invariants);
        return series(runs, () -> Nets.web(w), options, (m, r) -> {
            Map<String, Double> v = new LinkedHashMap<>();
            double arrived = r.fired(m.t("Надходження"));
            double done = 0;
            double inSystem = r.place(m.p("Запит"));
            for (int i = 0; i < SERVERS.length; i++) {
                String n = SERVERS[i];
                double rate = r.rate(m.t("Відповідь" + n));
                double inServer = 0;
                for (String p : stages(n)) {
                    inServer += r.place(m.p(p));
                }
                for (String t : work(n)) {
                    inServer += r.busy(m.t(t));
                }
                done += r.fired(m.t("Відповідь" + n));
                inSystem += inServer;
                // формула Літтла: середній час на етапі = середня кількість запитів на етапі / інтенсивність потоку
                v.put("time" + n, inServer / rate);
                v.put("queueWait" + n, r.place(m.p("Черга" + n)) / rate);
                v.put("coreWait" + n, r.place(m.p("Готовий" + n)) / rate);
                v.put("compute" + n, r.busy(m.t("Обчислення" + n)) / rate);
                v.put("dbWait" + n, r.place(m.p("Обчислено" + n)) / rate);
                v.put("write" + n, r.busy(m.t("Запис" + n)) / rate);
                v.put("reply" + n, r.busy(m.t("Відповідь" + n)) / rate);
                v.put("throughput" + n, rate);
                v.put("queue" + n, r.place(m.p("Черга" + n)));
                v.put("cores" + n, r.busy(m.t("Обчислення" + n)) / servers[i].cores());
                v.put("threads" + n, 1 - r.place(m.p("Потоки" + n)) / servers[i].threads());
            }
            v.put("arrivals", arrived / r.span);
            v.put("throughput", done / r.span);
            v.put("time", inSystem / (done / r.span));
            v.put("rejected", r.fired(m.t("Відмова")) / arrived);
            v.put("auxShare", r.fired(m.t("ДоДопоміжного")) / (double) (r.fired(m.t("ДоГоловного")) + r.fired(m.t("ДоДопоміжного"))));
            v.put("db", (r.busy(m.t("Запис1")) + r.busy(m.t("Запис2"))) / w.connections());
            v.put("queue", r.place(m.p("Черга1")) + r.place(m.p("Черга2")));
            v.put("queueMax", (double) (w.queueLimit() - r.minP[m.p("Місця").getNumber()]));
            return v;
        });
    }

    private static Series webSeries(Web w, int runs) {
        return webSeries(w, runs, WEB_TIME, WEB_WARMUP);
    }

    /** Час обробки запиту в мережі без обмеження потоків: вузли обчислень і БД — незалежні системи M/M/c. */
    private static Map<String, Object> webTheory(Web w) {
        double lambda = 1 / w.arrival();
        double[] share = {1 - w.auxShare(), w.auxShare()};
        Nets.Server[] servers = {w.main(), w.aux()};
        double dbWait = Stats.mmcWait(lambda, w.write(), w.connections());
        Map<String, Object> t = new LinkedHashMap<>();
        double total = 0;
        for (int i = 0; i < servers.length; i++) {
            double coreWait = Stats.mmcWait(lambda * share[i], servers[i].compute(), servers[i].cores());
            double time = coreWait + servers[i].compute() + dbWait + w.write() + w.reply();
            t.put("coreWait" + SERVERS[i], coreWait);
            t.put("time" + SERVERS[i], time);
            total += share[i] * time;
        }
        t.put("dbWait", dbWait);
        t.put("time", total);
        return t;
    }

    private static Map<String, Object> parameters(Web w) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("arrival", w.arrival());
        p.put("queueLimit", w.queueLimit());
        p.put("auxShare", w.auxShare());
        p.put("threads", List.of(w.main().threads(), w.aux().threads()));
        p.put("cores", List.of(w.main().cores(), w.aux().cores()));
        p.put("compute", List.of(w.main().compute(), w.aux().compute()));
        p.put("connections", w.connections());
        p.put("write", w.write());
        p.put("reply", w.reply());
        return p;
    }

    private static List<String> names(Object[] elements) {
        List<String> names = new ArrayList<>();
        for (Object e : elements) {
            names.add(e instanceof PetriP p ? p.getName() : ((PetriT) e).getName());
        }
        return names;
    }

    /** Короткий прогін, для якого у звіті виписано вектори матричних рівнянь станів. */
    private static Map<String, Object> webEquations(Web w) {
        Model m = Nets.web(w);
        PetriNet net = m.net();
        Sim.Result r = Sim.run(net, new Sim.Options(1_000, 0));
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("places", names(net.getListP()));
        e.put("transitions", names(net.getListT()));
        e.put("plus", Sim.outputMatrix(net));
        e.put("minus", Sim.inputMatrix(net));
        e.put("time", 1_000);
        e.put("initialMark", r.initialMark);
        List<Integer> mark = new ArrayList<>();
        for (PetriP p : net.getListP()) {
            mark.add(p.getMark());
        }
        List<Integer> active = new ArrayList<>();
        for (PetriT t : net.getListT()) {
            active.add(t.getBuffer());
        }
        e.put("mark", mark);
        e.put("active", active);
        e.put("entries", r.entriesTotal);
        e.put("exits", r.exitsTotal);
        e.put("mismatches", Sim.stateEquationMismatches(r));
        e.put("protocol", webProtocol(w));
        return e;
    }

    /** Стан S(t) = (M(t), E(t)) після входу маркерів у переходи в перші моменти подій — приклад до рівнянь станів. */
    private static List<Object> webProtocol(Web w) {
        List<Object> steps = new ArrayList<>();
        Model m = Nets.web(w);
        Sim.run(m.net(), new Sim.Options(1_000, 0).tracer((t, net) -> {
            if (steps.size() >= 7) {
                return;
            }
            Map<String, Object> marks = new LinkedHashMap<>();
            for (PetriP p : net.getListP()) {
                marks.put(p.getName(), p.getMark());
            }
            Map<String, Object> exits = new LinkedHashMap<>();
            for (PetriT tr : net.getListT()) {
                if (tr.getBuffer() > 0) {
                    exits.put(tr.getName(), new ArrayList<>(tr.getTimeOut()));
                }
            }
            Map<String, Object> step = new LinkedHashMap<>();
            step.put("t", t);
            step.put("marks", marks);
            step.put("exits", exits);
            steps.add(step);
        }));
        return steps;
    }

    private static Map<String, Object> web() {
        Web b = Web.BASE;
        Series base = webSeries(b, WEB_RUNS);
        Web unlimited = b.withThreads(1_000, 1_000);

        List<Object> variants = new ArrayList<>();
        variants.add(variant("базовий", base));
        variants.add(variant("надходження exp(4)", webSeries(b.withArrival(4), 5)));
        variants.add(variant("до допоміжного 0,5", webSeries(b.withAuxShare(0.5), 5)));
        variants.add(variant("ядер головного 12", webSeries(b.withMainCores(12), 5)));
        variants.add(variant("з’єднань з БД 5", webSeries(b.withConnections(5), 5)));
        variants.add(variant("потоків 8 і 4", webSeries(b.withThreads(8, 4), 5)));
        variants.add(variant("потоків 24 і 12", webSeries(b.withThreads(24, 12), 5)));

        List<Object> load = new ArrayList<>();
        for (double a : WEB_ARRIVALS) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("arrival", a);
            row.put("result", webSeries(b.withArrival(a), 5).estimates);
            load.add(row);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("run", Map.of("time", WEB_TIME, "warmup", WEB_WARMUP, "runs", WEB_RUNS));
        out.put("parameters", parameters(b));
        out.put("base", base.estimates);
        out.put("checks", base.checks());
        out.put("unlimited", webSeries(unlimited, WEB_RUNS).estimates);
        out.put("theory", webTheory(unlimited));
        out.put("variants", variants);
        out.put("load", load);
        out.put("equations", webEquations(b));
        return out;
    }
}
