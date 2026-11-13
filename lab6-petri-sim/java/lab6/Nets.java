package lab6;

import lab6.NetBuilder.Model;
import ua.stetsenkoinna.petriobj.PetriP;
import ua.stetsenkoinna.petriobj.PetriT;

/** Мережі Петрі трьох задач практикуму разом з розташуванням елементів на полотні редактора. */
final class Nets {
    private Nets() {}

    // ─────────────────────────────── Задача 1: конвеєр з п’ятьма пристроями (завдання 1 практикуму 5)

    static final int DEVICES = 5;

    /** Час у хвилинах. */
    record Conveyor(double arrival, double service, double transfer, double back) {
        static final Conveyor BASE = new Conveyor(0.25, 1, 1, 5);
    }

    static Model conveyor(Conveyor c) {
        NetBuilder b = new NetBuilder();
        // стрічка замкнена: пристрої 1–3 у верхньому ряду, 4–5 у нижньому, повернення замикає коло
        double[] x = {280, 480, 680, 760, 480};
        double[] y = {330, 330, 330, 550, 550};
        double[][] move = {{380, 330}, {580, 330}, {860, 440}, {620, 550}};

        PetriP generator = b.place("Генератор", 1, 60, 330);
        PetriP[] at = new PetriP[DEVICES];
        for (int i = 0; i < DEVICES; i++) {
            at[i] = b.place("Біля" + (i + 1), 0, x[i], y[i]);
        }
        PetriT arrive = b.transition("Надходження", c.arrival(), 170, 330);
        b.in(generator, arrive);
        b.out(arrive, generator);
        b.out(arrive, at[0]);

        for (int i = 0; i < DEVICES; i++) {
            boolean top = i < 3;
            double tx = x[i] + 70;
            double ty = top ? y[i] - 140 : y[i] + 140;
            PetriP free = b.place("Вільний" + (i + 1), 1, top ? x[i] - 20 : tx - 110, top ? y[i] - 210 : ty + 20);
            PetriP done = b.place("Готово" + (i + 1), 0, top ? tx : tx + 110, top ? y[i] - 280 : ty + 10);
            // пристрій знімає деталь зі стрічки, тільки якщо вільний: обробка має пріоритет над рухом далі
            PetriT serve = b.exp("Обробка" + (i + 1), c.service(), tx, ty);
            serve.setPriority(1);
            b.in(at[i], serve);
            b.in(free, serve);
            b.out(serve, free);
            b.out(serve, done);
        }
        for (int i = 0; i < DEVICES - 1; i++) {
            PetriT t = b.transition("Рух" + (i + 1) + (i + 2), c.transfer(), move[i][0], move[i][1]);
            b.in(at[i], t);
            b.out(t, at[i + 1]);
        }
        PetriT back = b.transition("Повернення", c.back(), 360, 550);
        b.in(at[DEVICES - 1], back);
        b.out(back, at[0]);
        return b.build("Conveyor");
    }

    // ─────────────────────────────── Задача 2: управління запасами холодильників (завдання 4 практикуму 5)

    /** Час у тижнях. */
    record Stock(double demand, double lost, double review, int level, int reorder, double lead) {
        static final Stock BASE = new Stock(0.2, 0.8, 4, 72, 18, 3);

        /** «поточний стан запасу ≤ точки замовлення» рівносильно «нестача до контрольного рівня ≥ порога» */
        int threshold() {
            return level - reorder;
        }
    }

    static Model stock(Stock s) {
        NetBuilder b = new NetBuilder();
        PetriP generator = b.place("Генератор", 1, 60, 330);
        PetriP buyer = b.place("Покупець", 0, 270, 330);
        PetriP stock = b.place("Запас", s.level(), 560, 60);
        PetriP gap = b.place("Нестача", 0, 560, 200);
        PetriP lost = b.place("Відмови", 0, 560, 330);
        PetriP backlog = b.place("Борг", 0, 540, 470);
        PetriP late = b.place("ВиданоПізніше", 0, 810, 470);
        PetriP transit = b.place("ВДорозі", 0, 880, 60);
        PetriP timer = b.place("Таймер", 1, 780, 590);
        PetriP decision = b.place("Перегляд", 0, 900, 430);
        PetriP ordering = b.place("Оформлення", 0, 900, 270);
        PetriP orders = b.place("Замовлення", 0, 1140, 270);
        PetriP skipped = b.place("БезЗамовлення", 0, 1140, 430);

        PetriT demand = b.exp("Попит", s.demand(), 160, 330);
        b.in(generator, demand);
        b.out(demand, generator);
        b.out(demand, buyer);

        PetriT sell = b.transition("Продаж", 0, 400, 200);
        sell.setPriority(2);
        b.in(buyer, sell);
        b.in(stock, sell);
        b.out(sell, gap);

        PetriT refuse = b.transition("Відмова", 0, 400, 330);
        refuse.setPriority(1);
        refuse.setProbability(s.lost());
        b.in(buyer, refuse);
        b.out(refuse, lost);

        PetriT wait = b.transition("Очікування", 0, 400, 470);
        wait.setPriority(1);
        wait.setProbability(Math.round((1 - s.lost()) * 1e6) / 1e6);
        b.in(buyer, wait);
        b.out(wait, backlog);
        b.out(wait, gap);

        PetriT serveLate = b.transition("Видача", 0, 680, 470);
        serveLate.setPriority(3);
        b.in(backlog, serveLate);
        b.in(stock, serveLate);
        b.out(serveLate, late);

        PetriT deliver = b.transition("Доставка", s.lead(), 720, 60);
        b.in(transit, deliver);
        b.out(deliver, stock);

        PetriT review = b.transition("Контроль", s.review(), 900, 590);
        b.in(timer, review);
        b.out(review, timer);
        b.out(review, decision);

        PetriT order = b.transition("Замовити", 0, 760, 350);
        order.setPriority(3);
        b.in(decision, order);
        b.info(gap, order, s.threshold());
        b.out(order, ordering);

        PetriT noOrder = b.transition("НеЗамовляти", 0, 1020, 430);
        noOrder.setPriority(1);
        b.in(decision, noOrder);
        b.out(noOrder, skipped);

        // замовлення набирається поштучно, доки нестача до контрольного рівня не стане нульовою
        PetriT topUp = b.transition("Дозамовлення", 0, 720, 200);
        topUp.setPriority(4);
        b.in(gap, topUp);
        b.info(ordering, topUp, 1);
        b.out(topUp, transit);

        PetriT close = b.transition("Кінець", 0, 1020, 270);
        close.setPriority(2);
        b.in(ordering, close);
        b.out(close, orders);
        return b.build("Stock");
    }

    // ─────────────────────────────── Задача 3: багатопотокова обробка запитів на двох серверах зі спільною БД

    /** Параметри одного сервера: потоки програми, ядра процесора, середній час обчислень. */
    record Server(int threads, int cores, double compute) {}

    /** Час у мілісекундах. */
    record Web(double arrival, int queueLimit, double auxShare, Server main, Server aux, int connections, double write, double reply) {
        static final Web BASE = new Web(2, 1000, 0.3, new Server(12, 8, 16), new Server(6, 4, 20), 6, 8, 1);

        Web withArrival(double a) {
            return new Web(a, queueLimit, auxShare, main, aux, connections, write, reply);
        }

        Web withThreads(int mainThreads, int auxThreads) {
            return new Web(arrival, queueLimit, auxShare, new Server(mainThreads, main.cores(), main.compute()),
                    new Server(auxThreads, aux.cores(), aux.compute()), connections, write, reply);
        }

        Web withConnections(int c) {
            return new Web(arrival, queueLimit, auxShare, main, aux, c, write, reply);
        }

        Web withAuxShare(double share) {
            return new Web(arrival, queueLimit, share, main, aux, connections, write, reply);
        }

        Web withMainCores(int cores) {
            return new Web(arrival, queueLimit, auxShare, new Server(main.threads(), cores, main.compute()), aux, connections, write, reply);
        }
    }

    static Model web(Web w) {
        NetBuilder b = new NetBuilder();
        PetriP generator = b.place("Генератор", 1, 60, 400);
        PetriP request = b.place("Запит", 0, 280, 400);
        PetriP slots = b.place("Місця", w.queueLimit(), 540, 400);
        PetriP rejected = b.place("Відхилено", 0, 60, 560);
        PetriP db = b.place("БД", w.connections(), 1040, 400);
        PetriP completed = b.place("Виконано", 0, 1570, 400);

        PetriT arrive = b.exp("Надходження", w.arrival(), 170, 400);
        b.in(generator, arrive);
        b.out(arrive, generator);
        b.out(arrive, request);

        // запит без вільного місця в черзі відхиляється: маршрутизація має пріоритет над відмовою
        PetriT reject = b.transition("Відмова", 0, 170, 560);
        b.in(request, reject);
        b.out(reject, rejected);

        Server[] servers = {w.main(), w.aux()};
        double[] share = {1 - w.auxShare(), w.auxShare()};
        for (int i = 0; i < servers.length; i++) {
            int n = i + 1;
            boolean top = i == 0;
            double row = top ? 200 : 600;
            double out = top ? -1 : 1;
            PetriP queue = b.place("Черга" + n, 0, 540, row);
            PetriP threads = b.place("Потоки" + n, servers[i].threads(), 540, row + out * 140);
            PetriP ready = b.place("Готовий" + n, 0, 780, row);
            PetriP cores = b.place("Ядра" + n, servers[i].cores(), 820, row - out * 130);
            PetriP computed = b.place("Обчислено" + n, 0, 1020, row);
            PetriP saved = b.place("Збережено" + n, 0, 1260, row);

            PetriT route = b.transition(top ? "ДоГоловного" : "ДоДопоміжного", 0, 420, row);
            route.setPriority(1);
            route.setProbability(share[i]);
            b.in(request, route);
            b.in(slots, route);
            b.out(route, queue);

            // потік береться з пулу на весь час обробки запиту, місце в черзі звільняється
            PetriT accept = b.transition("Прийняти" + n, 0, 660, row);
            b.in(queue, accept);
            b.in(threads, accept);
            b.out(accept, ready);
            b.out(accept, slots);

            PetriT compute = b.exp("Обчислення" + n, servers[i].compute(), 900, row);
            b.in(ready, compute);
            b.in(cores, compute);
            b.out(compute, computed);
            b.out(compute, cores);

            // під час запису потік чекає на введення-виведення і ядро не займає
            PetriT write = b.exp("Запис" + n, w.write(), 1140, row);
            b.in(computed, write);
            b.in(db, write);
            b.out(write, saved);
            b.out(write, db);

            PetriT reply = b.transition("Відповідь" + n, w.reply(), 1380, row + out * 100);
            b.in(saved, reply);
            b.out(reply, completed);
            b.out(reply, threads);
        }
        return b.build("WebServers");
    }
}
