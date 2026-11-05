// Marketplace: lists the .theame files in the public HomelabDrive folder and reads each
// one's manifest.json (and icon) straight out of the zip in the browser, so adding a
// theme to the site is just uploading the file to that folder.
(function () {
    "use strict";

    var FOLDER = "https://media.pophosting.xyz/assets/Theames/Themes/";

    var listEl = document.getElementById("themes");
    var statusEl = document.getElementById("status");
    var countEl = document.getElementById("count");
    var barCountEl = document.getElementById("status-count");
    var filterEl = document.getElementById("filter");
    var cards = [];

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function fmtSize(n) {
        if (n == null || isNaN(n)) return "";
        if (n < 1024) return n + " B";
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
        return (n / 1024 / 1024).toFixed(1) + " MB";
    }

    // ---- Folder listing ---------------------------------------------------
    // HomelabDrive's public page carries a plain <a href> list (the <noscript>
    // fallback); any web server's directory index works the same way.
    function listFolder() {
        return fetch(FOLDER, { cache: "no-cache" }).then(function (res) {
            if (!res.ok) throw new Error("folder listing: HTTP " + res.status);
            return res.text();
        }).then(function (html) {
            var seen = {};
            var out = [];
            var re = /href\s*=\s*["']([^"']+?\.theame)["']/gi;
            var m;
            while ((m = re.exec(html))) {
                var url = new URL(m[1].replace(/&amp;/g, "&"), FOLDER).href;
                if (url.indexOf(FOLDER) !== 0 || seen[url]) continue;
                seen[url] = true;
                out.push({ url: url, file: decodeURIComponent(url.slice(FOLDER.length)) });
            }
            return out;
        });
    }

    // ---- Minimal zip reader ----------------------------------------------
    function u16(d, o) { return d.getUint16(o, true); }
    function u32(d, o) { return d.getUint32(o, true); }

    function readZip(buf) {
        var d = new DataView(buf);
        var eocd = -1;
        for (var i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
            if (u32(d, i) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error("not a zip archive");
        var count = u16(d, eocd + 10);
        var p = u32(d, eocd + 16);
        var dec = new TextDecoder();
        var entries = {};
        for (var n = 0; n < count; n++) {
            if (u32(d, p) !== 0x02014b50) throw new Error("bad zip directory");
            var method = u16(d, p + 10);
            var csize = u32(d, p + 20);
            var nameLen = u16(d, p + 28);
            var extraLen = u16(d, p + 30);
            var commentLen = u16(d, p + 32);
            var local = u32(d, p + 42);
            var name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
            entries[name] = { method: method, csize: csize, local: local };
            p += 46 + nameLen + extraLen + commentLen;
        }
        return {
            has: function (name) { return !!entries[name]; },
            bytes: function (name) {
                var e = entries[name];
                if (!e) return Promise.reject(new Error("missing " + name));
                var start = e.local + 30 + u16(d, e.local + 26) + u16(d, e.local + 28);
                var raw = new Uint8Array(buf, start, e.csize);
                if (e.method === 0) return Promise.resolve(raw);
                if (e.method !== 8) return Promise.reject(new Error("unsupported compression"));
                var ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
                return new Response(ds).arrayBuffer().then(function (b) { return new Uint8Array(b); });
            }
        };
    }

    function mimeFor(name) {
        var ext = (name.split(".").pop() || "").toLowerCase();
        return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
                 webp: "image/webp", svg: "image/svg+xml" }[ext] || "application/octet-stream";
    }

    function loadTheme(item) {
        return fetch(item.url).then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.arrayBuffer();
        }).then(function (buf) {
            item.size = buf.byteLength;
            var zip = readZip(buf);
            return zip.bytes("manifest.json").then(function (b) {
                item.manifest = JSON.parse(new TextDecoder().decode(b));
                // Images come out of the archive as blob: URLs. A missing or broken one is
                // skipped, so it never hides the rest of the card.
                function image(path) {
                    if (typeof path !== "string" || !zip.has(path)) return Promise.resolve(null);
                    return zip.bytes(path).then(function (ib) {
                        return URL.createObjectURL(new Blob([ib], { type: mimeFor(path) }));
                    }).catch(function () { return null; });
                }
                // "preview" is marketplace-only: one image path, or a list of them.
                var pv = item.manifest.preview;
                var previews = (Array.isArray(pv) ? pv : [pv]).slice(0, 6);
                return Promise.all([image(item.manifest.icon)].concat(previews.map(image))).then(function (urls) {
                    item.iconUrl = urls[0];
                    item.previews = urls.slice(1).filter(Boolean);
                });
            });
        }).catch(function (err) {
            item.error = String(err && err.message || err);
        }).then(function () { return item; });
    }

    // ---- Rendering --------------------------------------------------------
    function names(list) {
        return (Array.isArray(list) ? list : []).map(function (x) { return x && x.name; }).filter(Boolean);
    }

    function partRow(ul, label, values) {
        if (!values.length) return;
        var li = el("li");
        li.appendChild(el("b", null, label));
        li.appendChild(document.createTextNode(values.join(", ")));
        ul.appendChild(li);
    }

    // Preview: the first image large; with several, numbered buttons switch between them.
    // Clicking the image opens it full size.
    function previewBox(urls, title) {
        var box = el("div", "theme-preview");
        var link = el("a");
        link.href = urls[0];
        link.target = "_blank";
        link.rel = "noopener";
        link.title = "Open full size";
        var img = el("img");
        img.src = urls[0];
        img.alt = "Preview of " + title;
        img.loading = "lazy";
        link.appendChild(img);
        box.appendChild(link);
        if (urls.length > 1) {
            var pick = el("div", "preview-pick");
            urls.forEach(function (u, i) {
                var b = el("button", null, String(i + 1));
                b.type = "button";
                b.setAttribute("aria-label", "Preview " + (i + 1));
                if (i === 0) b.className = "on";
                b.addEventListener("click", function () {
                    img.src = u;
                    link.href = u;
                    var all = pick.querySelectorAll("button");
                    for (var j = 0; j < all.length; j++) all[j].className = all[j] === b ? "on" : "";
                });
                pick.appendChild(b);
            });
            box.appendChild(pick);
        }
        return box;
    }

    function render(item) {
        var mf = item.manifest || {};
        var title = mf.name || item.file.replace(/\.theame$/i, "");

        var li = el("li");
        var win = el("div", "window theme-card");
        var bar = el("div", "title-bar");
        bar.appendChild(el("div", "title-bar-text", item.file));
        win.appendChild(bar);
        var body = el("div", "window-body");

        if (item.previews && item.previews.length) body.appendChild(previewBox(item.previews, title));

        var head = el("div", "theme-head");
        if (item.iconUrl) {
            var img = el("img", "theme-icon");
            img.src = item.iconUrl;
            img.alt = "";
            head.appendChild(img);
        } else {
            head.appendChild(el("div", "theme-icon placeholder", title.charAt(0).toUpperCase()));
        }
        var info = el("div");
        info.appendChild(el("p", "theme-title", title));
        var by = [];
        if (mf.version) by.push("v" + mf.version);
        if (mf.author) by.push("by " + mf.author);
        if (by.length) info.appendChild(el("p", "theme-by", by.join(" · ")));
        head.appendChild(info);
        body.appendChild(head);

        var desc = typeof mf.description === "string" ? mf.description.trim() : "";
        if (desc) body.appendChild(el("p", "theme-desc", desc));

        var parts = el("ul", "theme-parts");
        var mods = names(mf.mods), bgs = names(mf.backgrounds), chats = names(mf.chats);
        var vars = (Array.isArray(mf.variables) ? mf.variables : []).map(function (v) {
            return v && (v.label || v.name);
        }).filter(Boolean);
        partRow(parts, "Mods", mods);
        partRow(parts, "Backgrounds", bgs);
        partRow(parts, "Chat styles", chats);
        if (mf.icon) partRow(parts, "Icon", ["included"]);
        partRow(parts, "Settings", vars);
        if (item.error) partRow(parts, "Note", ["couldn't read this file's contents (" + item.error + ")"]);
        if (parts.childNodes.length) body.appendChild(parts);

        var foot = el("div", "theme-foot");
        foot.appendChild(el("span", "size", fmtSize(item.size)));
        var a = el("a", "button-link", "Download");
        a.href = item.url;
        a.setAttribute("download", item.file);
        foot.appendChild(a);
        body.appendChild(foot);

        win.appendChild(body);
        li.appendChild(win);

        item.search = [title, item.file, mf.author || "", desc].concat(mods, bgs, chats, vars).join(" ").toLowerCase();
        item.li = li;
        return li;
    }

    function applyFilter() {
        var q = filterEl.value.trim().toLowerCase();
        var shown = 0;
        cards.forEach(function (c) {
            var on = !q || c.search.indexOf(q) !== -1;
            c.li.hidden = !on;
            if (on) shown++;
        });
        var total = cards.length;
        var label = total === 1 ? "1 theme" : total + " themes";
        countEl.textContent = q ? shown + " of " + label : label;
        barCountEl.textContent = label;
    }

    function fail(err) {
        console.error(err);
        statusEl.className = "error-box";
        statusEl.textContent = "";
        statusEl.appendChild(document.createTextNode("Couldn't load the theme list. You can browse the files directly at "));
        var a = el("a", null, "media.pophosting.xyz/assets/Theames/Themes");
        a.href = FOLDER;
        statusEl.appendChild(a);
        statusEl.appendChild(document.createTextNode("."));
        barCountEl.textContent = "offline";
    }

    filterEl.addEventListener("input", applyFilter);

    listFolder().then(function (items) {
        if (!items.length) {
            statusEl.textContent = "No themes yet. Be the first: email yours to me@poplel.xyz.";
            barCountEl.textContent = "0 themes";
            return;
        }
        statusEl.textContent = "Reading " + items.length + " themes…";
        return Promise.all(items.map(loadTheme)).then(function (loaded) {
            loaded.sort(function (a, b) {
                var an = (a.manifest && a.manifest.name) || a.file;
                var bn = (b.manifest && b.manifest.name) || b.file;
                return an.localeCompare(bn, undefined, { sensitivity: "base" });
            });
            cards = loaded;
            loaded.forEach(function (it) { listEl.appendChild(render(it)); });
            statusEl.hidden = true;
            applyFilter();
        });
    }).catch(fail);
})();
