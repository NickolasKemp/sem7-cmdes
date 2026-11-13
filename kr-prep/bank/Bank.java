import java.util.*;
import java.util.function.BiConsumer;
import java.util.function.DoubleSupplier;

/*
 * Банк: клієнт -> оператор -> один із 2 касирів -> (p=0.15) знову до оператора, інакше вихід.
 * Якщо у відділенні вже 8 клієнтів, новий клієнт отримує відмову.
 * Вхід: надходження exp(3), оператор unif[1;3], касир unif[2;10].
 * Вихід: кількість відмов і середній час перебування клієнта в банку.
 */
public class Bank {
    static final Random RND = new Random();
    static final int MAX_IN_BANK = 8;
    static final double P_RETURN = 0.15;

    static double exp(double mean) { return -mean * Math.log(1 - RND.nextDouble()); }
    static double unif(double a, double b) { return a + (b - a) * RND.nextDouble(); }

    /** Клієнт пам'ятає момент входу, щоб порахувати час перебування. */
    record Client(double tIn) {}

    /** Спільна частина елементів: момент найближчої події і реакція на неї. */
    static abstract class Element {
        final String name;
        double tnext = Double.MAX_VALUE;
        Element(String name) { this.name = name; }
        abstract void outAct(double tcurr);
        void doStatistics(double dt) {}
    }

    /** Генератор вхідного потоку. */
    static class Create extends Element {
        final DoubleSupplier delay;
        final BiConsumer<Client, Double> next;
        Create(String name, DoubleSupplier delay, BiConsumer<Client, Double> next) {
            super(name); this.delay = delay; this.next = next; tnext = 0;
        }
        void outAct(double tcurr) {
            tnext = tcurr + delay.getAsDouble();
            next.accept(new Client(tcurr), tcurr);
        }
    }

    /** Пристрій з channels каналами і необмеженою чергою; куди йти далі, вирішує next. */
    static class Process extends Element {
        final Client[] inService;
        final double[] tEnd;
        final Deque<Client> queue = new ArrayDeque<>();
        final DoubleSupplier delay;
        BiConsumer<Client, Double> next;
        int served;
        double sumQueue, sumBusy;

        Process(String name, int channels, DoubleSupplier delay) {
            super(name); this.delay = delay;
            inService = new Client[channels];
            tEnd = new double[channels];
            Arrays.fill(tEnd, Double.MAX_VALUE);
        }

        void inAct(Client c, double tcurr) {
            for (int i = 0; i < inService.length; i++)
                if (inService[i] == null) { start(i, c, tcurr); return; }
            queue.add(c);
        }

        void start(int i, Client c, double tcurr) {
            inService[i] = c;
            tEnd[i] = tcurr + delay.getAsDouble();
            tnext = Arrays.stream(tEnd).min().getAsDouble();
        }

        void outAct(double tcurr) {
            for (int i = 0; i < inService.length; i++) {
                if (tEnd[i] != tcurr) continue;
                Client c = inService[i];
                inService[i] = null;
                tEnd[i] = Double.MAX_VALUE;
                served++;
                if (!queue.isEmpty()) start(i, queue.poll(), tcurr);
                next.accept(c, tcurr);
            }
            tnext = Arrays.stream(tEnd).min().getAsDouble();
        }

        void doStatistics(double dt) {
            sumQueue += queue.size() * dt;
            sumBusy += Arrays.stream(inService).filter(Objects::nonNull).count() * dt;
        }
    }

    // стан і статистика банку
    static int inBank, arrived, refused, left;
    static double sumTimeInBank, sumInBank;

    public static void main(String[] args) {
        double tmod = args.length > 0 ? Double.parseDouble(args[0]) : 100_000;

        Process operator = new Process("Оператор", 1, () -> unif(1, 3));
        Process cashiers = new Process("Касири", 2, () -> unif(2, 10));

        Create create = new Create("Вхід", () -> exp(3), (c, t) -> {
            arrived++;
            if (inBank >= MAX_IN_BANK) { refused++; return; }
            inBank++;
            operator.inAct(c, t);
        });
        operator.next = cashiers::inAct;
        cashiers.next = (c, t) -> {
            if (RND.nextDouble() < P_RETURN) { operator.inAct(c, t); return; }
            inBank--;
            left++;
            sumTimeInBank += t - c.tIn();
        };

        List<Element> elements = List.of(create, operator, cashiers);
        double tcurr = 0;
        while (tcurr < tmod) {
            Element e = elements.stream().min(Comparator.comparingDouble(x -> x.tnext)).get();
            double dt = e.tnext - tcurr;
            for (Element x : elements) x.doStatistics(dt);
            sumInBank += inBank * dt;
            tcurr = e.tnext;
            e.outAct(tcurr);
        }

        System.out.printf("Час моделювання: %.0f хв%n", tcurr);
        System.out.printf("Прибуло клієнтів: %d%n", arrived);
        System.out.printf("Втрачено через відмову: %d (ймовірність відмови %.4f)%n", refused, (double) refused / arrived);
        System.out.printf("Обслуговано (вийшли з банку): %d%n", left);
        System.out.printf("Середній час обслуговування одного клієнта: %.3f хв%n", sumTimeInBank / left);
        System.out.printf("Середня кількість клієнтів у банку: %.3f%n", sumInBank / tcurr);
        for (Process p : List.of(operator, cashiers))
            System.out.printf("%s: середня черга %.3f, завантаження %.3f%n",
                    p.name, p.sumQueue / tcurr, p.sumBusy / tcurr / p.inService.length);
    }
}
