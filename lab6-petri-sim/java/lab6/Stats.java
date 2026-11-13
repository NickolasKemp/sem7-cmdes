package lab6;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/** Оцінки за незалежними прогонами, теоретичні формули для перевірки і запис результатів у JSON. */
final class Stats {
    private Stats() {}

    /** Квантилі t-розподілу Стьюдента рівня 0,975 для 1…30 ступенів вільності. */
    private static final double[] T975 = {
        12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101,
        2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
    };

    /** Середнє і половина ширини 95 % довірчого інтервалу. */
    static Map<String, Object> estimate(List<Double> xs) {
        int n = xs.size();
        double mean = xs.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double ss = xs.stream().mapToDouble(x -> (x - mean) * (x - mean)).sum();
        double deviation = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
        double t = n > 1 ? T975[Math.min(n - 1, T975.length) - 1] : 0;
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("mean", mean);
        e.put("halfWidth", n > 1 ? t * deviation / Math.sqrt(n) : 0);
        return e;
    }

    /** Оцінки кожної характеристики за `runs` незалежними прогонами. */
    static Map<String, Object> replicate(int runs, Supplier<Map<String, Double>> run) {
        Map<String, List<Double>> samples = new LinkedHashMap<>();
        for (int i = 0; i < runs; i++) {
            run.get().forEach((k, v) -> samples.computeIfAbsent(k, key -> new ArrayList<>()).add(v));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        samples.forEach((k, v) -> out.put(k, estimate(v)));
        return out;
    }

    /** Середній час очікування в черзі системи M/M/c (формула Ерланга C). */
    static double mmcWait(double lambda, double service, int c) {
        double a = lambda * service;
        double rho = a / c;
        double sum = 0;
        double term = 1;
        for (int k = 0; k < c; k++) {
            sum += term;
            term *= a / (k + 1);
        }
        double tail = term / (1 - rho);
        double waitProbability = tail / (sum + tail);
        return waitProbability * service / (c * (1 - rho));
    }

    static String json(Object value) {
        StringBuilder sb = new StringBuilder();
        write(sb, value, 0);
        return sb.append('\n').toString();
    }

    private static void write(StringBuilder sb, Object v, int depth) {
        String pad = "  ".repeat(depth + 1);
        if (v instanceof Map<?, ?> map) {
            sb.append("{\n");
            int i = 0;
            for (Map.Entry<?, ?> e : map.entrySet()) {
                sb.append(pad).append('"').append(e.getKey()).append("\": ");
                write(sb, e.getValue(), depth + 1);
                sb.append(++i < map.size() ? ",\n" : "\n");
            }
            sb.append("  ".repeat(depth)).append('}');
        } else if (v instanceof List<?> list) {
            sb.append('[');
            for (int i = 0; i < list.size(); i++) {
                write(sb, list.get(i), depth + 1);
                if (i < list.size() - 1) {
                    sb.append(", ");
                }
            }
            sb.append(']');
        } else if (v instanceof int[] ints) {
            write(sb, java.util.Arrays.stream(ints).boxed().toList(), depth);
        } else if (v instanceof long[] longs) {
            write(sb, java.util.Arrays.stream(longs).boxed().toList(), depth);
        } else if (v instanceof double[] doubles) {
            write(sb, java.util.Arrays.stream(doubles).boxed().toList(), depth);
        } else if (v instanceof int[][] rows) {
            write(sb, java.util.Arrays.stream(rows).toList(), depth);
        } else if (v instanceof String s) {
            sb.append('"').append(s.replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
        } else if (v instanceof Double d && (d.isNaN() || d.isInfinite())) {
            sb.append("null");
        } else {
            sb.append(v);
        }
    }
}
