package lab6;

import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.Rectangle;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.ObjectOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import lab6.NetBuilder.Model;
import ua.stetsenkoinna.graphnet.GraphElement;
import ua.stetsenkoinna.graphnet.GraphNetBuilder;
import ua.stetsenkoinna.graphnet.GraphPetriNet;
import ua.stetsenkoinna.graphpresentation.FileUse;
import ua.stetsenkoinna.petriobj.ArcIn;
import ua.stetsenkoinna.petriobj.ArcOut;
import ua.stetsenkoinna.petriobj.PetriNet;
import ua.stetsenkoinna.pnml.PnmlGenerator;
import ua.stetsenkoinna.pnml.PnmlParser;

/**
 * Пакет файлів мережі Петрі засобами PetriObjModelPaint: рисунок полотна редактора (.png), збережена графічна
 * мережа Save GraphNet (.pns), PNML і Java-метод створення мережі.
 */
final class Export {
    private static final int MARGIN = 50;
    private static final int SCALE = 2;

    private Export() {}

    static void writePackage(Model model, Path dir, String taskText) throws Exception {
        Files.createDirectories(dir);
        PetriNet net = model.net();
        GraphPetriNet graph = GraphNetBuilder.build(net, model.placeXY(), model.transitionXY(), null, false);

        Files.writeString(dir.resolve("task.txt"), taskText + "\n", StandardCharsets.UTF_8);
        ImageIO.write(render(graph), "png", dir.resolve("net.png").toFile());
        try (ObjectOutputStream oos = new ObjectOutputStream(new FileOutputStream(dir.resolve("net.pns").toFile()))) {
            oos.writeObject(graph);
        }
        File pnml = dir.resolve("net.pnml").toFile();
        new PnmlGenerator().generate(net, pnml, graph);
        Files.writeString(dir.resolve("method.txt"), new FileUse().saveNetAsMethod(graph).strip() + "\n", StandardCharsets.UTF_8);
        requireSameStructure(net, new PnmlParser().parse(pnml));
    }

    /** Те саме зображення, що малює полотно редактора: мережа малюється методом paintGraphPetriNet. */
    private static BufferedImage render(GraphPetriNet graph) {
        Rectangle box = null;
        for (GraphElement e : graph.getGraphPetriPlaceList()) {
            box = box == null ? new Rectangle(e.getBounds()) : box.union(e.getBounds());
        }
        for (GraphElement e : graph.getGraphPetriTransitionList()) {
            box = box.union(e.getBounds());
        }
        // підписи затримки й імовірності редактор малює під переходом, назви — над елементом
        int width = box.x + box.width + MARGIN + 40;
        int height = box.y + box.height + MARGIN + 30;
        BufferedImage image = new BufferedImage(width * SCALE, height * SCALE, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, image.getWidth(), image.getHeight());
        g.scale(SCALE, SCALE);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        g.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 12));
        graph.paintGraphPetriNet(g, g);
        g.dispose();
        return image;
    }

    /** PNML, прочитаний назад, має описувати ту саму мережу: інакше файл пакета не відтворює модель. */
    private static void requireSameStructure(PetriNet a, PetriNet b) {
        check(a.getListP().length == b.getListP().length, "кількість позицій");
        check(a.getListT().length == b.getListT().length, "кількість переходів");
        check(a.getArcIn().length == b.getArcIn().length, "кількість вхідних дуг");
        check(a.getArcOut().length == b.getArcOut().length, "кількість вихідних дуг");
        for (int i = 0; i < a.getListP().length; i++) {
            check(a.getListP()[i].getName().equals(b.getListP()[i].getName()), "назва позиції " + i);
            check(a.getListP()[i].getMark() == b.getListP()[i].getMark(), "маркірування позиції " + i);
        }
        for (int i = 0; i < a.getListT().length; i++) {
            var ta = a.getListT()[i];
            var tb = b.getListT()[i];
            check(ta.getName().equals(tb.getName()), "назва переходу " + i);
            check(ta.getParameter() == tb.getParameter(), "затримка переходу " + ta.getName());
            check(java.util.Objects.equals(ta.getDistribution(), tb.getDistribution()), "розподіл переходу " + ta.getName());
            check(ta.getPriority() == tb.getPriority(), "пріоритет переходу " + ta.getName());
            check(ta.getProbability() == tb.getProbability(), "ймовірність переходу " + ta.getName());
        }
        for (int i = 0; i < a.getArcIn().length; i++) {
            ArcIn x = a.getArcIn()[i];
            ArcIn y = b.getArcIn()[i];
            check(x.getNumP() == y.getNumP() && x.getNumT() == y.getNumT() && x.getQuantity() == y.getQuantity() && x.getIsInf() == y.getIsInf(),
                    "вхідна дуга " + i);
        }
        for (int i = 0; i < a.getArcOut().length; i++) {
            ArcOut x = a.getArcOut()[i];
            ArcOut y = b.getArcOut()[i];
            check(x.getNumP() == y.getNumP() && x.getNumT() == y.getNumT() && x.getQuantity() == y.getQuantity(), "вихідна дуга " + i);
        }
    }

    /** Копія рисунка, повернута на чверть оберту: широка мережа займає у звіті всю висоту сторінки. */
    static void writeRotated(Path png, Path rotated) throws Exception {
        BufferedImage source = ImageIO.read(png.toFile());
        BufferedImage image = new BufferedImage(source.getHeight(), source.getWidth(), BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.translate(0, source.getWidth());
        g.rotate(-Math.PI / 2);
        g.drawImage(source, 0, 0, null);
        g.dispose();
        ImageIO.write(image, "png", rotated.toFile());
    }

    private static void check(boolean ok, String what) {
        if (!ok) {
            throw new IllegalStateException("PNML не відтворює мережу: " + what);
        }
    }
}
