(function() {
  window.DrawingBoard = (typeof DrawingBoard !== "undefined" ? DrawingBoard : {});

  /*
  pass the id of the html element to put the drawing board into
  and some options : {
  controls: array of controls to initialize with the drawingboard. 'Colors', 'Size', and 'Navigation' by default
  instead of simple strings, you can pass an object to define a control opts
  ie ['Color', { Navigation: { reset: false }}]
  controlsPosition: "top left" by default. Define where to put the controls: at the "top" or "bottom" of the canvas, aligned to "left"/"right"/"center"
  background: background of the drawing board. Give a hex color or an image url "#ffffff" (white) by default
  color: pencil color ("#000000" by default)
  size: pencil size (3 by default)
  webStorage: 'session', 'local' or false ('session' by default). store the current drawing in session or local storage and restore it when you come back
  droppable: true or false (false by default). If true, dropping an image on the canvas will include it and allow you to draw on it,
  errorMessage: html string to put in the board's element on browsers that don't support canvas.
  }
  */


  DrawingBoard.Board = function(id, opts) {
    var tpl;
    this.opts = this.mergeOptions(opts);
    this.ev = new DrawingBoard.Utils.MicroEvent();
    this.id = id;
    this.$el = $(document.getElementById(id));
    if (!this.$el.length) {
      return false;
    }
    tpl = "<div class=\"drawing-board-canvas-wrapper\"></canvas><canvas class=\"drawing-board-canvas\"></canvas><div class=\"drawing-board-cursor drawing-board-utils-hidden\"></div></div>";
    if (this.opts.controlsPosition.indexOf("bottom") > -1) {
      tpl += "<div class=\"drawing-board-controls\"></div>";
    } else {
      tpl = "<div class=\"drawing-board-controls\"></div>" + tpl;
    }
    this.$el.addClass("drawing-board").append(tpl);
    this.dom = {
      $canvasWrapper: this.$el.find(".drawing-board-canvas-wrapper"),
      $canvas: this.$el.find(".drawing-board-canvas"),
      $cursor: this.$el.find(".drawing-board-cursor"),
      $controls: this.$el.find(".drawing-board-controls")
    };
    $.each(["left", "right", "center"], $.proxy(function(n, val) {
      if (this.opts.controlsPosition.indexOf(val) > -1) {
        this.dom.$controls.attr("data-align", val);
        return false;
      }
    }, this));
    this.canvas = this.dom.$canvas.get(0);
    this.ctx = (this.canvas && this.canvas.getContext && this.canvas.getContext("2d") ? this.canvas.getContext("2d") : null);
    this.color = this.opts.color;
    if (!this.ctx) {
      if (this.opts.errorMessage) {
        this.$el.html(this.opts.errorMessage);
      }
      return false;
    }
    this.storage = this._getStorage();
    this.initHistory();
    this.reset({
      webStorage: false,
      history: false,
      background: false
    });
    this.initControls();
    this.resize();
    this.reset({
      webStorage: false,
      history: true,
      background: true
    });
    this.restoreWebStorage();
    this.initDropEvents();
    this.initDrawEvents();
  };

  DrawingBoard.Board.defaultOpts = {
    controls: ["Color", "DrawingMode", "Size", "Navigation"],
    controlsPosition: "top left",
    color: "#000000",
    size: 1,
    background: "#fff",
    eraserColor: "background",
    fillTolerance: 100,
    webStorage: "session",
    droppable: false,
    enlargeYourContainer: false,
    errorMessage: "<p>It seems you use an obsolete browser. <a href=\"http://browsehappy.com/\" target=\"_blank\">Update it</a> to start drawing.</p>"
  };

  DrawingBoard.Board.prototype = {
    mergeOptions: function(opts) {
      opts = $.extend({}, DrawingBoard.Board.defaultOpts, opts);
      if (!opts.background && opts.eraserColor === "background") {
        opts.eraserColor = "transparent";
      }
      return opts;
    },
    /*
    Canvas reset/resize methods: put back the canvas to its default values
    
    depending on options, can set color, size, background back to default values
    and store the reseted canvas in webstorage and history queue
    
    resize values depend on the `enlargeYourContainer` option
    */

    reset: function(opts) {
      opts = $.extend({
        color: this.opts.color,
        size: this.opts.size,
        webStorage: true,
        history: true,
        background: false
      }, opts);
      this.setMode("pencil");
      if (opts.background) {
        this.resetBackground(this.opts.background, false);
      }
      if (opts.color) {
        this.setColor(opts.color);
      }
      if (opts.size) {
        this.ctx.lineWidth = opts.size;
      }
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
      if (opts.webStorage) {
        this.saveWebStorage();
      }
      if (opts.history) {
        this.saveHistory();
      }
      this.blankCanvas = this.getImg();
      this.ev.trigger("board:reset", opts);
    },
    resetBackground: function(background, historize) {
      var bgIsColor, prevMode;
      background = background || this.opts.background;
      historize = (typeof historize !== "undefined" ? historize : true);
      bgIsColor = DrawingBoard.Utils.isColor(background);
      prevMode = this.getMode();
      this.setMode("pencil");
      this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.width);
      if (bgIsColor) {
        this.ctx.fillStyle = background;
        this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
      } else {
        if (background) {
          this.setImg(background);
        }
      }
      this.setMode(prevMode);
      if (historize) {
        this.saveHistory();
      }
    },
    resize: function() {
      var canvasHeight, canvasWidth, heights, sub, sum, that, widths;
      this.dom.$controls.toggleClass("drawing-board-controls-hidden", !this.controls || !this.controls.length);
      canvasWidth = void 0;
      canvasHeight = void 0;
      widths = [this.$el.width(), DrawingBoard.Utils.boxBorderWidth(this.$el), DrawingBoard.Utils.boxBorderWidth(this.dom.$canvasWrapper, true, true)];
      heights = [this.$el.height(), DrawingBoard.Utils.boxBorderHeight(this.$el), this.dom.$controls.height(), DrawingBoard.Utils.boxBorderHeight(this.dom.$controls, false, true), DrawingBoard.Utils.boxBorderHeight(this.dom.$canvasWrapper, true, true)];
      that = this;
      sum = function(values, multiplier) {
        var i, res;
        multiplier = multiplier || 1;
        res = values[0];
        i = 1;
        while (i < values.length) {
          res = res + (values[i] * multiplier);
          i++;
        }
        return res;
      };
      sub = function(values) {
        return sum(values, -1);
      };
      if (this.opts.enlargeYourContainer) {
        canvasWidth = this.$el.width();
        canvasHeight = this.$el.height();
        this.$el.width(sum(widths));
        this.$el.height(sum(heights));
      } else {
        canvasWidth = sub(widths);
        canvasHeight = sub(heights);
      }
      this.dom.$canvasWrapper.css("width", canvasWidth + "px");
      this.dom.$canvasWrapper.css("height", canvasHeight + "px");
      this.dom.$canvas.css("width", canvasWidth + "px");
      this.dom.$canvas.css("height", canvasHeight + "px");
      this.canvas.width = canvasWidth;
      this.canvas.height = canvasHeight;
    },
    /*
    Controls:
    the drawing board can has various UI elements to control it.
    one control is represented by a class in the namespace DrawingBoard.Control
    it must have a $el property (jQuery object), representing the html element to append on the drawing board at initialization.
    */

    initControls: function() {
      var c, controlName, i;
      this.controls = [];
      if (!this.opts.controls.length || !DrawingBoard.Control) {
        return false;
      }
      i = 0;
      while (i < this.opts.controls.length) {
        c = null;
        if (typeof this.opts.controls[i] === "string") {
          c = new window["DrawingBoard"]["Control"][this.opts.controls[i]](this);
        } else if (typeof this.opts.controls[i] === "object") {
          for (controlName in this.opts.controls[i]) {
            continue;
          }
          c = new window["DrawingBoard"]["Control"][controlName](this, this.opts.controls[i][controlName]);
        }
        if (c) {
          this.addControl(c);
        }
        i++;
      }
    },
    addControl: function(control, optsOrPos, pos) {
      var opts;
      if (typeof control !== "string" && (typeof control !== "object" || !control instanceof DrawingBoard.Control)) {
        return false;
      }
      opts = (typeof optsOrPos === "object" ? optsOrPos : {});
      pos = (pos ? pos * 1 : (typeof optsOrPos === "number" ? optsOrPos : null));
      if (typeof control === "string") {
        control = new window["DrawingBoard"]["Control"][control](this, opts);
      }
      if (pos) {
        this.dom.$controls.children().eq(pos).before(control.$el);
      } else {
        this.dom.$controls.append(control.$el);
      }
      if (!this.controls) {
        this.controls = [];
      }
      this.controls.push(control);
      this.dom.$controls.removeClass("drawing-board-controls-hidden");
    },
    /*
    History methods: undo and redo drawed lines
    */

    initHistory: function() {
      this.history = {
        values: [],
        position: 0
      };
    },
    saveHistory: function() {
      while (this.history.values.length > 30) {
        this.history.values.shift();
        this.history.position--;
      }
      if (this.history.position !== 0 && this.history.position < this.history.values.length) {
        this.history.values = this.history.values.slice(0, this.history.position);
        this.history.position++;
      } else {
        this.history.position = this.history.values.length + 1;
      }
      this.history.values.push(this.getImg());
      this.ev.trigger("historyNavigation", this.history.position);
    },
    _goThroughHistory: function(goForth) {
      var pos;
      if ((goForth && this.history.position === this.history.values.length) || (!goForth && this.history.position === 1)) {
        return;
      }
      pos = (goForth ? this.history.position + 1 : this.history.position - 1);
      if (this.history.values.length && (this.history.values[pos - 1] != null)) {
        this.history.position = pos;
        this.setImg(this.history.values[pos - 1]);
      }
      this.ev.trigger("historyNavigation", pos);
      this.saveWebStorage();
    },
    goBackInHistory: function() {
      this._goThroughHistory(false);
    },
    goForthInHistory: function() {
      this._goThroughHistory(true);
    },
    /*
    Image methods: you can directly put an image on the canvas, get it in base64 data url or start a download
    */

    setImg: function(src) {
      var ctx, img, oldGCO;
      ctx = this.ctx;
      img = new Image();
      oldGCO = ctx.globalCompositeOperation;
      img.onload = function() {
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.width);
        ctx.drawImage(img, 0, 0);
        ctx.globalCompositeOperation = oldGCO;
      };
      img.src = src;
    },
    getImg: function() {
      return this.canvas.toDataURL("image/png");
    },
    downloadImg: function() {
      var img;
      img = this.getImg();
      img = img.replace("image/png", "image/octet-stream");
      window.location.href = img;
    },
    /*
    WebStorage handling : save and restore to local or session storage
    */

    saveWebStorage: function() {
      if (window[this.storage]) {
        window[this.storage].setItem("drawing-board-" + this.id, this.getImg());
        this.ev.trigger("board:save" + this.storage.charAt(0).toUpperCase() + this.storage.slice(1), this.getImg());
      }
    },
    restoreWebStorage: function() {
      if (window[this.storage] && window[this.storage].getItem("drawing-board-" + this.id) !== null) {
        this.setImg(window[this.storage].getItem("drawing-board-" + this.id));
        this.ev.trigger("board:restore" + this.storage.charAt(0).toUpperCase() + this.storage.slice(1), window[this.storage].getItem("drawing-board-" + this.id));
      }
    },
    clearWebStorage: function() {
      if (window[this.storage] && window[this.storage].getItem("drawing-board-" + this.id) !== null) {
        window[this.storage].removeItem("drawing-board-" + this.id);
        this.ev.trigger("board:clear" + this.storage.charAt(0).toUpperCase() + this.storage.slice(1));
      }
    },
    _getStorage: function() {
      if (!this.opts.webStorage || !(this.opts.webStorage === "session" || this.opts.webStorage === "local")) {
        return false;
      }
      return this.opts.webStorage + "Storage";
    },
    /*
    Drop an image on the canvas to draw on it
    */

    initDropEvents: function() {
      if (!this.opts.droppable) {
        return false;
      }
      this.dom.$canvas.on("dragover dragenter drop", function(e) {
        e.stopPropagation();
        e.preventDefault();
      });
      this.dom.$canvas.on("drop", $.proxy(this._onCanvasDrop, this));
    },
    _onCanvasDrop: function(e) {
      var files, fr;
      e = (e.originalEvent ? e.originalEvent : e);
      files = e.dataTransfer.files;
      if (!files || !files.length || files[0].type.indexOf("image") === -1 || !window.FileReader) {
        return false;
      }
      fr = new FileReader();
      fr.readAsDataURL(files[0]);
      fr.onload = $.proxy(function(ev) {
        this.setImg(ev.target.result);
        this.ev.trigger("board:imageDropped", ev.target.result);
        this.ev.trigger("board:userAction");
        this.saveHistory();
      }, this);
    },
    /*
    set and get current drawing mode
    
    possible modes are "pencil" (draw normally), "eraser" (draw transparent, like, erase, you know), "filler" (paint can)
    */

    setMode: function(newMode, silent) {
      silent = silent || false;
      newMode = newMode || "pencil";
      this.ev.unbind("board:startDrawing", $.proxy(this.fill, this));
      if (this.opts.eraserColor === "transparent") {
        this.ctx.globalCompositeOperation = (newMode === "eraser" ? "destination-out" : "source-over");
      } else {
        if (newMode === "eraser") {
          if (this.opts.eraserColor === "background" && DrawingBoard.Utils.isColor(this.opts.background)) {
            this.ctx.strokeStyle = this.opts.background;
          } else {
            if (DrawingBoard.Utils.isColor(this.opts.eraserColor)) {
              this.ctx.strokeStyle = this.opts.eraserColor;
            }
          }
        } else {
          if (!this.mode || this.mode === "eraser") {
            this.ctx.strokeStyle = this.color;
          }
        }
        if (newMode === "filler") {
          this.ev.bind("board:startDrawing", $.proxy(this.fill, this));
        }
      }
      this.mode = newMode;
      if (!silent) {
        this.ev.trigger("board:mode", this.mode);
      }
    },
    getMode: function() {
      return this.mode || "pencil";
    },
    setColor: function(color) {
      var setStrokeStyle, that;
      that = this;
      color = color || this.color;
      if (!DrawingBoard.Utils.isColor(color)) {
        return false;
      }
      this.color = color;
      if (this.opts.eraserColor !== "transparent" && this.mode === "eraser") {
        setStrokeStyle = function(mode) {
          if (mode !== "eraser") {
            that.strokeStyle = that.color;
          }
          that.ev.unbind("board:mode", setStrokeStyle);
        };
        this.ev.bind("board:mode", setStrokeStyle);
      } else {
        this.ctx.strokeStyle = this.color;
      }
    },
    /*
    Fills an area with the current stroke color.
    */

    fill: function(e) {
      var COLOR, INDEX, X, Y, b, g, img, maxX, maxY, pixel, queue, r, start, startColor, stroke, tolerance, x, y;
      if (this.getImg() === this.blankCanvas) {
        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.width);
        this.ctx.fillStyle = this.color;
        this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
        return;
      }
      img = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      INDEX = 0;
      X = 1;
      Y = 2;
      COLOR = 3;
      stroke = this.ctx.strokeStyle;
      r = parseInt(stroke.substr(1, 2), 16);
      g = parseInt(stroke.substr(3, 2), 16);
      b = parseInt(stroke.substr(5, 2), 16);
      start = DrawingBoard.Utils.pixelAt(img, parseInt(e.coords.x, 10), parseInt(e.coords.y, 10));
      startColor = start[COLOR];
      tolerance = this.opts.fillTolerance;
      if (DrawingBoard.Utils.compareColors(startColor, DrawingBoard.Utils.RGBToInt(r, g, b), tolerance)) {
        return;
      }
      queue = [start];
      pixel = void 0;
      x = void 0;
      y = void 0;
      maxX = img.width - 1;
      maxY = img.height - 1;
      while ((pixel = queue.pop())) {
        if (DrawingBoard.Utils.compareColors(pixel[COLOR], startColor, tolerance)) {
          img.data[pixel[INDEX]] = r;
          img.data[pixel[INDEX] + 1] = g;
          img.data[pixel[INDEX] + 2] = b;
          if (pixel[X] > 0) {
            queue.push(DrawingBoard.Utils.pixelAt(img, pixel[X] - 1, pixel[Y]));
          }
          if (pixel[X] < maxX) {
            queue.push(DrawingBoard.Utils.pixelAt(img, pixel[X] + 1, pixel[Y]));
          }
          if (pixel[Y] > 0) {
            queue.push(DrawingBoard.Utils.pixelAt(img, pixel[X], pixel[Y] - 1));
          }
          if (pixel[Y] < maxY) {
            queue.push(DrawingBoard.Utils.pixelAt(img, pixel[X], pixel[Y] + 1));
          }
        }
      }
      this.ctx.putImageData(img, 0, 0);
    },
    /*
    Drawing handling, with mouse or touch
    */

    initDrawEvents: function() {
      this.isDrawing = false;
      this.isMouseHovering = false;
      this.coords = {};
      this.coords.old = this.coords.current = this.coords.oldMid = {
        x: 0,
        y: 0
      };
      this.dom.$canvas.on("mousedown touchstart", $.proxy(function(e) {
        this._onInputStart(e, this._getInputCoords(e));
      }, this));
      this.dom.$canvas.on("mousemove touchmove", $.proxy(function(e) {
        this._onInputMove(e, this._getInputCoords(e));
      }, this));
      this.dom.$canvas.on("mousemove", $.proxy(function(e) {}, this));
      this.dom.$canvas.on("mouseup touchend", $.proxy(function(e) {
        this._onInputStop(e, this._getInputCoords(e));
      }, this));
      this.dom.$canvas.on("mouseover", $.proxy(function(e) {
        this._onMouseOver(e, this._getInputCoords(e));
      }, this));
      this.dom.$canvas.on("mouseout", $.proxy(function(e) {
        this._onMouseOut(e, this._getInputCoords(e));
      }, this));
      $("body").on("mouseup touchend", $.proxy(function(e) {
        this.isDrawing = false;
      }, this));
      if (window.requestAnimationFrame) {
        requestAnimationFrame($.proxy(this.draw, this));
      }
    },
    draw: function() {
      var currentMid, transform;
      if (window.requestAnimationFrame && this.ctx.lineWidth > 10 && this.isMouseHovering) {
        this.dom.$cursor.css({
          width: this.ctx.lineWidth + "px",
          height: this.ctx.lineWidth + "px"
        });
        transform = DrawingBoard.Utils.tpl("translateX({{x}}px) translateY({{y}}px)", {
          x: this.coords.current.x - (this.ctx.lineWidth / 2),
          y: this.coords.current.y - (this.ctx.lineWidth / 2)
        });
        this.dom.$cursor.css({
          transform: transform,
          "-webkit-transform": transform,
          "-ms-transform": transform
        });
        this.dom.$cursor.removeClass("drawing-board-utils-hidden");
      } else {
        this.dom.$cursor.addClass("drawing-board-utils-hidden");
      }
      if (this.isDrawing) {
        currentMid = this._getMidInputCoords(this.coords.current);
        this.ctx.beginPath();
        this.ctx.moveTo(currentMid.x, currentMid.y);
        this.ctx.quadraticCurveTo(this.coords.old.x, this.coords.old.y, this.coords.oldMid.x, this.coords.oldMid.y);
        this.ctx.stroke();
        this.coords.old = this.coords.current;
        this.coords.oldMid = currentMid;
      }
      if (window.requestAnimationFrame) {
        requestAnimationFrame($.proxy(function() {
          this.draw();
        }, this));
      }
    },
    _onInputStart: function(e, coords) {
      this.coords.current = this.coords.old = coords;
      this.coords.oldMid = this._getMidInputCoords(coords);
      this.isDrawing = true;
      if (!window.requestAnimationFrame) {
        this.draw();
      }
      this.ev.trigger("board:startDrawing", {
        e: e,
        coords: coords
      });
      e.stopPropagation();
      e.preventDefault();
    },
    _onInputMove: function(e, coords) {
      this.coords.current = coords;
      this.ev.trigger("board:drawing", {
        e: e,
        coords: coords
      });
      if (!window.requestAnimationFrame) {
        this.draw();
      }
      e.stopPropagation();
      e.preventDefault();
    },
    _onInputStop: function(e, coords) {
      if (this.isDrawing && (!e.touches || e.touches.length === 0)) {
        this.isDrawing = false;
        this.saveWebStorage();
        this.saveHistory();
        this.ev.trigger("board:stopDrawing", {
          e: e,
          coords: coords
        });
        this.ev.trigger("board:userAction");
        e.stopPropagation();
        e.preventDefault();
      }
    },
    _onMouseOver: function(e, coords) {
      this.isMouseHovering = true;
      this.coords.old = this._getInputCoords(e);
      this.coords.oldMid = this._getMidInputCoords(this.coords.old);
      this.ev.trigger("board:mouseOver", {
        e: e,
        coords: coords
      });
    },
    _onMouseOut: function(e, coords) {
      this.isMouseHovering = false;
      this.ev.trigger("board:mouseOut", {
        e: e,
        coords: coords
      });
    },
    _getInputCoords: function(e) {
      var x, y;
      e = (e.originalEvent ? e.originalEvent : e);
      x = void 0;
      y = void 0;
      if (e.touches && e.touches.length === 1) {
        x = e.touches[0].pageX;
        y = e.touches[0].pageY;
      } else {
        x = e.pageX;
        y = e.pageY;
      }
      return {
        x: x - this.dom.$canvas.offset().left,
        y: y - this.dom.$canvas.offset().top
      };
    },
    _getMidInputCoords: function(coords) {
      return {
        x: this.coords.old.x + coords.x >> 1,
        y: this.coords.old.y + coords.y >> 1
      };
    }
  };

  window.DrawingBoard = (typeof DrawingBoard !== "undefined" ? DrawingBoard : {});

  DrawingBoard.Utils = {};

  DrawingBoard.Utils.tpl = (function() {
    "use strict";
    var end, path, pattern, start, undef;
    start = "{{";
    end = "}}";
    path = "[a-z0-9_][\\.a-z0-9_]*";
    pattern = new RegExp(start + "\\s*(" + path + ")\\s*" + end, "gi");
    undef = void 0;
    return function(template, data) {
      return template.replace(pattern, function(tag, token) {
        var i, len, lookup;
        path = token.split(".");
        len = path.length;
        lookup = data;
        i = 0;
        while (i < len) {
          lookup = lookup[path[i]];
          if (lookup === undef) {
            throw new Error("tim: '" + path[i] + "' not found in " + tag);
          }
          if (i === len - 1) {
            return lookup;
          }
          i++;
        }
      });
    };
  })();

  /*
  https://github.com/jeromeetienne/microevent.js
  MicroEvent - to make any js object an event emitter (server or browser)
  
  - pure javascript - server compatible, browser compatible
  - dont rely on the browser doms
  - super simple - you get it immediatly, no mistery, no magic involved
  
  - create a MicroEventDebug with goodies to debug
  - make it safer to use
  */


  DrawingBoard.Utils.MicroEvent = function() {};

  DrawingBoard.Utils.MicroEvent.prototype = {
    bind: function(event, fct) {
      this._events = this._events || {};
      this._events[event] = this._events[event] || [];
      this._events[event].push(fct);
    },
    unbind: function(event, fct) {
      this._events = this._events || {};
      if (event in this._events === false) {
        return;
      }
      this._events[event].splice(this._events[event].indexOf(fct), 1);
    },
    trigger: function(event) {
      var i;
      this._events = this._events || {};
      if (event in this._events === false) {
        return;
      }
      i = 0;
      while (i < this._events[event].length) {
        this._events[event][i].apply(this, Array.prototype.slice.call(arguments_, 1));
        i++;
      }
    }
  };

  DrawingBoard.Utils._boxBorderSize = function($el, withPadding, withMargin, direction) {
    var i, props, width;
    withPadding = !!withPadding || true;
    withMargin = !!withMargin || false;
    width = 0;
    props = void 0;
    if (direction === "width") {
      props = ["border-left-width", "border-right-width"];
      if (withPadding) {
        props.push("padding-left", "padding-right");
      }
      if (withMargin) {
        props.push("margin-left", "margin-right");
      }
    } else {
      props = ["border-top-width", "border-bottom-width"];
      if (withPadding) {
        props.push("padding-top", "padding-bottom");
      }
      if (withMargin) {
        props.push("margin-top", "margin-bottom");
      }
    }
    i = props.length - 1;
    while (i >= 0) {
      width += parseInt($el.css(props[i]).replace("px", ""), 10);
      i--;
    }
    return width;
  };

  DrawingBoard.Utils.boxBorderWidth = function($el, withPadding, withMargin) {
    return DrawingBoard.Utils._boxBorderSize($el, withPadding, withMargin, "width");
  };

  DrawingBoard.Utils.boxBorderHeight = function($el, withPadding, withMargin) {
    return DrawingBoard.Utils._boxBorderSize($el, withPadding, withMargin, "height");
  };

  DrawingBoard.Utils.isColor = function(string) {
    if (!string || !string.length) {
      return false;
    }
    return /(^#[0-9A-F]{6}$)|(^#[0-9A-F]{3}$)/i.test(string) || $.inArray(string.substring(0, 3), ["rgb", "hsl"]) !== -1;
  };

  /*
  Packs an RGB color into a single integer.
  */


  DrawingBoard.Utils.RGBToInt = function(r, g, b) {
    var c;
    c = 0;
    c |= (r & 255) << 16;
    c |= (g & 255) << 8;
    c |= b & 255;
    return c;
  };

  /*
  Returns informations on the pixel located at (x,y).
  */


  DrawingBoard.Utils.pixelAt = function(image, x, y) {
    var c, i;
    i = (y * image.width + x) * 4;
    c = DrawingBoard.Utils.RGBToInt(image.data[i], image.data[i + 1], image.data[i + 2]);
    return [i, x, y, c];
  };

  /*
  Compares two colors with the given tolerance (between 0 and 255).
  */


  DrawingBoard.Utils.compareColors = function(a, b, tolerance) {
    var ba, bb, ga, gb, ra, rb;
    if (tolerance === 0) {
      return a === b;
    }
    ra = (a >> 16) & 255;
    rb = (b >> 16) & 255;
    ga = (a >> 8) & 255;
    gb = (b >> 8) & 255;
    ba = a & 255;
    bb = b & 255;
    return (Math.abs(ra - rb) <= tolerance) && (Math.abs(ga - gb) <= tolerance) && (Math.abs(ba - bb) <= tolerance);
  };

  (function() {
    var lastTime, vendors, x;
    lastTime = 0;
    vendors = ["ms", "moz", "webkit", "o"];
    x = 0;
    while (x < vendors.length && !window.requestAnimationFrame) {
      window.requestAnimationFrame = window[vendors[x] + "RequestAnimationFrame"];
      window.cancelAnimationFrame = window[vendors[x] + "CancelAnimationFrame"] || window[vendors[x] + "CancelRequestAnimationFrame"];
      ++x;
    }
  })();

}).call(this);
