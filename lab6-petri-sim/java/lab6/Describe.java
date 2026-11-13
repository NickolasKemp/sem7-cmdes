package lab6;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import ua.stetsenkoinna.petriobj.ArcIn;
import ua.stetsenkoinna.petriobj.ArcOut;
import ua.stetsenkoinna.petriobj.PetriNet;
import ua.stetsenkoinna.petriobj.PetriP;
import ua.stetsenkoinna.petriobj.PetriT;

/** Структура мережі Петрі у вигляді даних: з неї звіт будує таблиці переходів і рівняння станів, а сторінка-симулятор — рисунок. */
final class Describe {
    private Describe() {}

    static Map<String, Object> all() {
        Map<String, Object> nets = new LinkedHashMap<>();
        nets.put("conveyor", net(Nets.conveyor(Nets.Conveyor.BASE)));
        nets.put("stock", net(Nets.stock(Nets.Stock.BASE)));
        nets.put("web", net(Nets.web(Nets.Web.BASE)));
        return nets;
    }

    private static Map<String, Object> net(NetBuilder.Model model) {
        PetriNet net = model.net();
        List<Object> places = new ArrayList<>();
        for (PetriP p : net.getListP()) {
            Map<String, Object> place = new LinkedHashMap<>();
            place.put("name", p.getName());
            place.put("mark", p.getMark());
            place.put("x", model.placeXY().get(p.getNumber()).x);
            place.put("y", model.placeXY().get(p.getNumber()).y);
            places.add(place);
        }
        List<Object> transitions = new ArrayList<>();
        for (PetriT t : net.getListT()) {
            Map<String, Object> tr = new LinkedHashMap<>();
            tr.put("name", t.getName());
            tr.put("delay", t.getParameter());
            tr.put("distribution", t.getDistribution() == null ? "const" : t.getDistribution());
            tr.put("priority", t.getPriority());
            tr.put("probability", t.getProbability());
            tr.put("x", model.transitionXY().get(t.getNumber()).x);
            tr.put("y", model.transitionXY().get(t.getNumber()).y);
            List<Object> in = new ArrayList<>();
            for (ArcIn a : net.getArcIn()) {
                if (a.getNumT() == t.getNumber()) {
                    Map<String, Object> arc = new LinkedHashMap<>();
                    arc.put("place", a.getNumP());
                    arc.put("k", a.getQuantity());
                    arc.put("info", a.getIsInf());
                    in.add(arc);
                }
            }
            List<Object> out = new ArrayList<>();
            for (ArcOut a : net.getArcOut()) {
                if (a.getNumT() == t.getNumber()) {
                    Map<String, Object> arc = new LinkedHashMap<>();
                    arc.put("place", a.getNumP());
                    arc.put("k", a.getQuantity());
                    out.add(arc);
                }
            }
            tr.put("in", in);
            tr.put("out", out);
            transitions.add(tr);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", net.getName());
        out.put("places", places);
        out.put("transitions", transitions);
        return out;
    }
}
