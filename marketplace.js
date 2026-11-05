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
        // no-cache: revalidate every time (a cheap 304 when unchanged), so a re-uploaded theme
        // is never shown from an old copy the browser kept.
        return fetch(item.url, { cache: "no-cache" }).then(function (res) {
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

    // Everything shown about a theme, worked out once from its manifest.
    function describe(item) {
        var mf = item.manifest || {};
        return {
            title: mf.name || item.file.replace(/\.theame$/i, ""),
            by: [mf.version ? "v" + mf.version : "", mf.author ? "by " + mf.author : ""].filter(Boolean).join(" · "),
            desc: typeof mf.description === "string" ? mf.description.trim() : "",
            mods: names(mf.mods),
            bgs: names(mf.backgrounds),
            chats: names(mf.chats),
            icon: !!mf.icon,
            vars: (Array.isArray(mf.variables) ? mf.variables : []).map(function (v) {
                return v && (v.label || v.name);
            }).filter(Boolean)
        };
    }

    // Preview image; with several, numbered buttons switch between them. On a card, clicking
    // the image opens the details window (onOpen); in the details window it opens full size.
    function previewBox(urls, title, onOpen) {
        var box = el("div", "theme-preview");
        var link = el("a");
        var img = el("img");
        img.src = urls[0];
        img.alt = "Preview of " + title;
        if (onOpen) {
            img.loading = "lazy";
            link.href = "#";
            link.title = "Show details";
            link.addEventListener("click", function (e) { e.preventDefault(); onOpen(); });
        } else {
            link.href = urls[0];
            link.target = "_blank";
            link.rel = "noopener";
            link.title = "Open full size";
        }
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
                    if (!onOpen) link.href = u;
                    var all = pick.querySelectorAll("button");
                    for (var j = 0; j < all.length; j++) all[j].className = all[j] === b ? "on" : "";
                });
                pick.appendChild(b);
            });
            box.appendChild(pick);
        }
        return box;
    }

    function headBlock(item, d) {
        var head = el("div", "theme-head");
        if (item.iconUrl) {
            var img = el("img", "theme-icon");
            img.src = item.iconUrl;
            img.alt = "";
            head.appendChild(img);
        } else {
            head.appendChild(el("div", "theme-icon placeholder", d.title.charAt(0).toUpperCase()));
        }
        var info = el("div");
        info.appendChild(el("p", "theme-title", d.title));
        if (d.by) info.appendChild(el("p", "theme-by", d.by));
        head.appendChild(info);
        return head;
    }

    function partsBlock(item, d) {
        var parts = el("ul", "theme-parts");
        partRow(parts, "Mods", d.mods);
        partRow(parts, "Backgrounds", d.bgs);
        partRow(parts, "Chat styles", d.chats);
        if (d.icon) partRow(parts, "Icon", ["included"]);
        partRow(parts, "Settings", d.vars);
        if (item.error) partRow(parts, "Note", ["couldn't read this file's contents (" + item.error + ")"]);
        return parts.childNodes.length ? parts : null;
    }

    function downloadLink(item) {
        var a = el("a", "button-link", "Download");
        a.href = item.url;
        a.setAttribute("download", item.file);
        return a;
    }

    function render(item) {
        var d = describe(item);
        var open = function () { openDetails(item); };

        var li = el("li");
        var win = el("div", "window theme-card");
        var bar = el("div", "title-bar");
        bar.appendChild(el("div", "title-bar-text", item.file));
        win.appendChild(bar);
        var body = el("div", "window-body");

        if (item.previews && item.previews.length) body.appendChild(previewBox(item.previews, d.title, open));
        body.appendChild(headBlock(item, d));
        if (d.desc) body.appendChild(el("p", "theme-desc", d.desc));
        var parts = partsBlock(item, d);
        if (parts) body.appendChild(parts);

        var foot = el("div", "theme-foot");
        foot.appendChild(el("span", "size", fmtSize(item.size)));
        var btns = el("span", "theme-buttons");
        var more = el("button", null, "Details");
        more.type = "button";
        more.addEventListener("click", open);
        btns.appendChild(more);
        btns.appendChild(downloadLink(item));
        foot.appendChild(btns);
        body.appendChild(foot);

        win.appendChild(body);
        li.appendChild(win);

        item.search = [d.title, item.file, (item.manifest && item.manifest.author) || "", d.desc]
            .concat(d.mods, d.bgs, d.chats, d.vars).join(" ").toLowerCase();
        item.li = li;
        return li;
    }

    // ---- Details window ---------------------------------------------------
    // One <dialog>, refilled per theme. The address bar gets #File.theame, so a details
    // window can be linked to directly.
    var dialog = el("dialog", "window theme-dialog");
    dialog.setAttribute("aria-labelledby", "theme-dialog-title");
    var dBar = el("div", "title-bar");
    var dTitle = el("div", "title-bar-text");
    dTitle.id = "theme-dialog-title";
    var dCtl = el("div", "title-bar-controls");
    var dClose = el("button");
    dClose.setAttribute("aria-label", "Close");
    dClose.addEventListener("click", function () { dialog.close(); });
    dCtl.appendChild(dClose);
    dBar.appendChild(dTitle);
    dBar.appendChild(dCtl);
    var dBody = el("div", "window-body");
    dialog.appendChild(dBar);
    dialog.appendChild(dBody);
    document.body.appendChild(dialog);
    // a click on the dimmed backdrop lands on the dialog element itself
    dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener("close", function () {
        if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    });

    function openDetails(item) {
        var d = describe(item);
        dTitle.textContent = d.title + " — " + item.file;
        dBody.textContent = "";
        if (item.previews && item.previews.length) dBody.appendChild(previewBox(item.previews, d.title, null));
        dBody.appendChild(headBlock(item, d));
        if (d.desc) dBody.appendChild(el("p", "theme-desc", d.desc));
        var parts = partsBlock(item, d);
        if (parts) dBody.appendChild(parts);
        var foot = el("div", "theme-foot");
        foot.appendChild(el("span", "size", fmtSize(item.size)));
        foot.appendChild(downloadLink(item));
        dBody.appendChild(foot);
        history.replaceState(null, "", "#" + encodeURIComponent(item.file));
        if (!dialog.open) dialog.showModal();
        dBody.scrollTop = 0;
        dClose.focus();
    }

    function openFromHash() {
        var want = decodeURIComponent(location.hash.slice(1));
        if (!want) return;
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].file === want) { openDetails(cards[i]); return; }
        }
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
            openFromHash();
        });
    }).catch(fail);
})();
