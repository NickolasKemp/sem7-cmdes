package lab6;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.ToIntFunction;
import ua.stetsenkoinna.petriobj.ArcIn;
import ua.stetsenkoinna.petriobj.ArcOut;
import ua.stetsenkoinna.petriobj.FiringPhase;
import ua.stetsenkoinna.petriobj.PetriNet;
import ua.stetsenkoinna.petriobj.PetriP;
import ua.stetsenkoinna.petriobj.PetriSim;
import ua.stetsenkoinna.petriobj.PetriT;

/**
 * Прогін мережі Петрі алгоритмом класу PetriSim: вхід маркерів у переходи (input), просування часу до найближчої
 * події, вихід маркерів (output). Статистика збирається тут як середнє в часі після періоду розгону, бо PetriSim
 * рахує середні лише від нульового моменту.
 */
final class Sim {
    private Sim() {}

    /** Величина стану мережі, для якої збирається середнє, максимум і розподіл у часі. */
    static final class Gauge {
        private final ToIntFunction<PetriNet> value;
        private final TreeMap<Integer, Double> time = new TreeMap<>();
        private double weighted;
        private int max = Integer.MIN_VALUE;

        Gauge(ToIntFunction<PetriNet> value) {
            this.value = value;
        }

        private void add(PetriNet net, double dt) {
            int v = value.applyAsInt(net);
            weighted += v * dt;
            max = Math.max(max, v);
            time.merge(v, dt, Double::sum);
        }

        double mean(double span) {
            return weighted / span;
        }

        int max() {
            return max;
        }

        double share(int v, double span) {
            return time.getOrDefault(v, 0.0) / span;
        }
    }

    interface Tracer {
        void event(double t, PetriNet net);
    }

    record Options(double time, double warmup, Map<String, ToIntFunction<PetriNet>> gauges, Map<String, ToIntFunction<PetriNet>> invariants, Tracer tracer) {
        Options(double time, double warmup) {
            this(time, warmup, Map.of(), Map.of(), null);
        }

        Options gauges(Map<String, ToIntFunction<PetriNet>> g) {
            return new Options(time, warmup, g, invariants, tracer);
        }

        Options invariants(Map<String, ToIntFunction<PetriNet>> inv) {
            return new Options(time, warmup, gauges, inv, tracer);
        }

        Options tracer(Tracer t) {
            return new Options(time, warmup, gauges, invariants, t);
        }
    }

    static final class Result {
        final PetriNet net;
        /** тривалість збирання статистики: час моделювання без розгону */
        final double span;
        final double[] meanP;
        final int[] maxP;
        final int[] minP;
        final double[] meanT;
        /** входи маркерів у переходи та виходи з них після розгону */
        final long[] entries;
        final long[] exits;
        /** те саме від початку прогону — для рівнянь станів */
        final long[] entriesTotal;
        final long[] exitsTotal;
        final int[] initialMark;
        final Map<String, Gauge> gauges = new LinkedHashMap<>();
        /** скільки разів порушився кожен інваріант (має бути нуль) */
        final Map<String, Integer> violations = new LinkedHashMap<>();
        long events;

        Result(PetriNet net, double span) {
            this.net = net;
            this.span = span;
            int p = net.getListP().length;
            int t = net.getListT().length;
            meanP = new double[p];
            maxP = new int[p];
            minP = new int[p];
            meanT = new double[t];
            entries = new long[t];
            exits = new long[t];
            entriesTotal = new long[t];
            exitsTotal = new long[t];
            initialMark = new int[p];
        }

        double place(PetriP p) {
            return meanP[p.getNumber()];
        }

        double busy(PetriT t) {
            return meanT[t.getNumber()];
        }

        long fired(PetriT t) {
            return exits[t.getNumber()];
        }

        double rate(PetriT t) {
            return fired(t) / span;
        }

        double gauge(String name) {
            return gauges.get(name).mean(span);
        }

        double share(String name, int v) {
            return gauges.get(name).share(v, span);
        }
    }

    static Result run(PetriNet net, Options o) {
        PetriSim sim = new PetriSim(net);
        PetriP[] places = net.getListP();
        PetriT[] transitions = net.getListT();
        Result r = new Result(net, o.time() - o.warmup());
        o.gauges().forEach((name, f) -> r.gauges.put(name, new Gauge(f)));
        Map<String, Integer> expected = new LinkedHashMap<>();
        o.invariants().forEach((name, f) -> {
            expected.put(name, f.applyAsInt(net));
            r.violations.put(name, 0);
        });
        for (int i = 0; i < places.length; i++) {
            r.initialMark[i] = places[i].getMark();
            r.maxP[i] = r.minP[i] = places[i].getMark();
        }
        sim.setFiringListener((phase, t, time) -> {
            if (phase == FiringPhase.AFTER_ACT_IN) {
                r.entriesTotal[t.getNumber()]++;
            } else if (phase == FiringPhase.AFTER_ACT_OUT) {
                r.exitsTotal[t.getNumber()]++;
            }
        });

        double t = 0;
        long[] entriesAtWarmup = null;
        long[] exitsAtWarmup = null;
        sim.setTimeCurr(0);
        sim.input();
        if (o.tracer() != null) {
            o.tracer().event(0, net);
        }
        while (true) {
            double next = Math.min(sim.getTimeMin(), o.time());
            if (entriesAtWarmup == null && next > o.warmup()) {
                entriesAtWarmup = r.entriesTotal.clone();
                exitsAtWarmup = r.exitsTotal.clone();
            }
            double dt = next - Math.max(t, o.warmup());
            if (dt > 0) {
                for (int i = 0; i < places.length; i++) {
                    r.meanP[i] += places[i].getMark() * dt;
                }
                for (int i = 0; i < transitions.length; i++) {
                    r.meanT[i] += transitions[i].getBuffer() * dt;
                }
                for (Gauge g : r.gauges.values()) {
                    g.add(net, dt);
                }
            }
            for (int i = 0; i < places.length; i++) {
                r.maxP[i] = Math.max(r.maxP[i], places[i].getMark());
                r.minP[i] = Math.min(r.minP[i], places[i].getMark());
            }
            expected.forEach((name, value) -> {
                if (o.invariants().get(name).applyAsInt(net) != value) {
                    r.violations.merge(name, 1, Integer::sum);
                }
            });
            t = next;
            if (t >= o.time()) {
                break;
            }
            sim.setTimeCurr(t);
            sim.output();
            sim.input();
            r.events++;
            if (o.tracer() != null) {
                o.tracer().event(t, net);
            }
        }
        for (int i = 0; i < places.length; i++) {
            r.meanP[i] /= r.span;
        }
        for (int i = 0; i < transitions.length; i++) {
            r.meanT[i] /= r.span;
            r.entries[i] = r.entriesTotal[i] - (entriesAtWarmup == null ? 0 : entriesAtWarmup[i]);
            r.exits[i] = r.exitsTotal[i] - (exitsAtWarmup == null ? 0 : exitsAtWarmup[i]);
        }
        return r;
    }

    /** Матриця виходів a⁺ (рядки — позиції, стовпці — переходи). */
    static int[][] outputMatrix(PetriNet net) {
        int[][] a = new int[net.getListP().length][net.getListT().length];
        for (ArcOut arc : net.getArcOut()) {
            a[arc.getNumP()][arc.getNumT()] += arc.getQuantity();
        }
        return a;
    }

    /** Матриця входів a⁻; інформаційні дуги маркерів не забирають і до неї не входять. */
    static int[][] inputMatrix(PetriNet net) {
        int[][] a = new int[net.getListP().length][net.getListT().length];
        for (ArcIn arc : net.getArcIn()) {
            if (!arc.getIsInf()) {
                a[arc.getNumP()][arc.getNumT()] += arc.getQuantity();
            }
        }
        return a;
    }

    /**
     * Перевірка матричних рівнянь станів на кінець прогону: μ(tₙ) = μ(t₀) + a·γ(tₙ) і η(tₙ) = γ(tₙ) − v(tₙ) + v(t₀),
     * де v(t₀) = 0. Повертає кількість позицій і переходів, для яких рівняння не виконалось.
     */
    static int stateEquationMismatches(Result r) {
        PetriNet net = r.net;
        int[][] plus = outputMatrix(net);
        int[][] minus = inputMatrix(net);
        PetriP[] places = net.getListP();
        PetriT[] transitions = net.getListT();
        int bad = 0;
        for (int p = 0; p < places.length; p++) {
            long left = places[p].getMark();
            long right = r.initialMark[p];
            for (int t = 0; t < transitions.length; t++) {
                left += (long) plus[p][t] * transitions[t].getBuffer();
                right += (long) (plus[p][t] - minus[p][t]) * r.entriesTotal[t];
            }
            if (left != right) {
                bad++;
            }
        }
        for (int t = 0; t < transitions.length; t++) {
            if (r.exitsTotal[t] != r.entriesTotal[t] - transitions[t].getBuffer()) {
                bad++;
            }
        }
        return bad;
    }
}
