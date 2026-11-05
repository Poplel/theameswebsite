(function () {
    "use strict";

    var nav = document.querySelector("nav.sidebar");
    if (!nav) return;

    function normalise(path) {
        return path.length > 1 ? path.replace(/\/+$/, "") : path;
    }

    var here = normalise(window.location.pathname);

    fetch("/sidebar.html")
        .then(function (res) {
            if (!res.ok) throw new Error("sidebar.html: HTTP " + res.status);
            return res.text();
        })
        .then(function (html) {
            nav.innerHTML = html;

            var links = nav.querySelectorAll('a[href^="/"]');
            for (var i = 0; i < links.length; i++) {
                var href = links[i].getAttribute("href");
                if (href.indexOf("#") === -1 && normalise(href) === here) {
                    links[i].classList.add("active");
                }
            }
            if (here === "/docs" || here.indexOf("/docs/") === 0) {
                var sections = nav.querySelectorAll(".tree-view details");
                for (var j = 0; j < sections.length; j++) sections[j].open = true;
            }
        })
        .catch(function (err) {
            console.error("Sidebar failed to load:", err);
        });
})();
