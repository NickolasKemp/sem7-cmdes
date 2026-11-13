package lab6;

import java.awt.geom.Point2D;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import ua.stetsenkoinna.petriobj.ArcIn;
import ua.stetsenkoinna.petriobj.ArcOut;
import ua.stetsenkoinna.petriobj.ExceptionInvalidTimeDelay;
import ua.stetsenkoinna.petriobj.PetriNet;
import ua.stetsenkoinna.petriobj.PetriP;
import ua.stetsenkoinna.petriobj.PetriT;

/**
 * Збирає мережу Петрі бібліотеки PetriObjModelPaint з іменованих елементів і запам’ятовує їхнє розташування
 * на полотні редактора, щоб та сама мережа і моделювалась, і зберігалась як рисунок та PNML.
 */
final class NetBuilder {
    private final ArrayList<PetriP> places = new ArrayList<>();
    private final ArrayList<PetriT> transitions = new ArrayList<>();
    private final ArrayList<ArcIn> ins = new ArrayList<>();
    private final ArrayList<ArcOut> outs = new ArrayList<>();
    private final Map<Integer, Point2D.Double> placeXY = new HashMap<>();
    private final Map<Integer, Point2D.Double> transitionXY = new HashMap<>();

    NetBuilder() {
        resetCounters();
    }

    /** Номери елементів — це індекси в масивах мережі, тому лічильники бібліотеки мають стартувати з нуля. */
    private static void resetCounters() {
        PetriP.initNext();
        PetriT.initNext();
        ArcIn.initNext();
        ArcOut.initNext();
    }

    PetriP place(String name, int mark, double x, double y) {
        PetriP p = new PetriP(name, mark);
        places.add(p);
        placeXY.put(p.getNumber(), new Point2D.Double(x, y));
        return p;
    }

    /** Перехід зі сталою затримкою; закон розподілу, пріоритет і ймовірність задаються на поверненому об’єкті. */
    PetriT transition(String name, double delay, double x, double y) {
        PetriT t = new PetriT(name, delay);
        transitions.add(t);
        transitionXY.put(t.getNumber(), new Point2D.Double(x, y));
        return t;
    }

    PetriT exp(String name, double mean, double x, double y) {
        PetriT t = transition(name, mean, x, y);
        t.setDistribution("exp", mean);
        return t;
    }

    void in(PetriP p, PetriT t) {
        in(p, t, 1);
    }

    void in(PetriP p, PetriT t, int k) {
        ins.add(new ArcIn(p, t, k));
    }

    /** Інформаційна дуга: маркери перевіряються, але не забираються. */
    void info(PetriP p, PetriT t, int k) {
        ins.add(new ArcIn(p, t, k, true));
    }

    void out(PetriT t, PetriP p) {
        out(t, p, 1);
    }

    void out(PetriT t, PetriP p, int k) {
        outs.add(new ArcOut(t, p, k));
    }

    Model build(String name) {
        try {
            PetriNet net = new PetriNet(name, places, transitions, ins, outs);
            resetCounters();
            return new Model(net, placeXY, transitionXY);
        } catch (ExceptionInvalidTimeDelay e) {
            throw new IllegalStateException(e);
        }
    }

    record Model(PetriNet net, Map<Integer, Point2D.Double> placeXY, Map<Integer, Point2D.Double> transitionXY) {
        PetriP p(String name) {
            for (PetriP p : net.getListP()) {
                if (p.getName().equals(name)) {
                    return p;
                }
            }
            throw new IllegalArgumentException("немає позиції " + name);
        }

        PetriT t(String name) {
            for (PetriT t : net.getListT()) {
                if (t.getName().equals(name)) {
                    return t;
                }
            }
            throw new IllegalArgumentException("немає переходу " + name);
        }
    }
}
