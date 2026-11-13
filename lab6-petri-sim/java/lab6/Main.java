package lab6;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Точка входу: `package` — пакети файлів мереж та їхня структура, `simulate` — усі досліди з результатами у JSON. */
public final class Main {
    private Main() {}

    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[1]);
        switch (args[0]) {
            case "package" -> {
                Packages.write(root.resolve("package"));
                Files.createDirectories(root.resolve("out"));
                Export.writeRotated(root.resolve("package/task3-web/net.png"), root.resolve("out/task3-web-rotated.png"));
                Files.writeString(root.resolve("out/nets.json"), Stats.json(Describe.all()), StandardCharsets.UTF_8);
            }
            case "simulate" -> Experiments.run(root.resolve("out"));
            default -> throw new IllegalArgumentException("невідома команда " + args[0]);
        }
    }
}
