"use strict";
var vis = function() {
  var stateKey, eventKey, keys = {
    hidden: "visibilitychange",
    webkitHidden: "webkitvisibilitychange",
    mozHidden: "mozvisibilitychange",
    msHidden: "msvisibilitychange"
  };
  for (stateKey in keys) {
    if (stateKey in document) {
      eventKey = keys[stateKey];
      break;
    }
  }
  return function(c) {
    if (c)
      document.addEventListener(eventKey, c);
    return !document[stateKey];
  };
}();
function onmove(ev) {
  hovering = null;
  let rmSettings = true;
  hoveringConn = null;
  hoveringTrain = null;
  currPos_canv = fromCanvPos(ev.clientX, ev.clientY);
  if (holdState == K.HOLD) {
    translate(ev.movementX, ev.movementY);
    redraw();
  }
  let actualPos = fromCanvPos(ev.clientX, ev.clientY);
  let nConn = nearestConnection(actualPos.x, actualPos.y);
  let nStop = nearestStop(actualPos, acceptRadius);
  if (holdState == K.HOLD_ADDTRAIN) {
    let newTrain = {
      x: actualPos.x,
      y: actualPos.y,
      from: null,
      to: null,
      lineID: -1,
      colour: defaultClr,
      startT: timeNow(),
      status: K.MOVING,
      passengers: [],
      cap: 6,
      revDir: false,
      percentCovered: 0,
      pendingMove: true,
      moving: true
    };
    trains.push(newTrain);
    holdState = K.HOLD_TRAIN;
    modifyingTrain = newTrain;
  }
  if (holdState == K.HOLD_NEWLINE) {
    let lastStop = currPath[currPath.length - 1];
    if (nStop) {
      let canAdd = true;
      for (let i = 0; i < currPath.length && canAdd; i++) {
        if (samePt(currPath[i], nStop))
          canAdd = false;
      }
      let newConn = { from: lastStop, to: nStop };
      if (parallelConnections(newConn).ct >= 3)
        canAdd = false;
      else if (!canAdd && currPath.length > 2 && samePt(nStop, currPath[0]) && !samePt(nStop, lastStop)) {
        currPath.push(nStop);
        routeConfirm();
      }
      if (canAdd) {
        currPath.push(nStop);
      }
    }
    redraw();
  } else if (holdState == K.HOLD_CONNECTION) {
    if (nStop) {
      let currLine = lines[modifyingConn.lineID];
      let newConn = {
        from: modifyingConn.from,
        to: nStop,
        lineID: modifyingConn.lineID,
        colour: modifyingConn.colour
      };
      let newConn2 = {
        from: nStop,
        to: modifyingConn.to,
        lineID: modifyingConn.lineID,
        colour: modifyingConn.colour
      };
      if (parallelConnections(newConn).ct < 3 && parallelConnections(newConn2).ct < 3 && !lines[modifyingConn.lineID].stops.has(nStop)) {
        for (affectedTrain of currLine.trains) {
          if (getAssociatedConnection(affectedTrain) == modifyingConn) {
            modifyingConn.pendingRemove = true;
            break;
          }
        }
        currLine.stops.add(nStop);
        connections.push(newConn);
        connections.push(newConn2);
        if (!modifyingConn.pendingRemove) {
          modifyingConn.pendingRemove = true;
          updateToNow(currLine, modifyingConn);
        }
        typesOnLine[modifyingConn.lineID].add(nStop.type);
        nStop.linesServed.add(modifyingConn.lineID);
        let idx = currLine.path.indexOf(modifyingConn.from);
        currLine.path.splice(idx + 1, 0, nStop);
        recalculateLineConnections();
        for (let pass2 of passengers)
          handlePassenger(pass2);
        holdState = K.NOHOLD;
        routeConfirm();
      }
    }
  } else if (holdState == K.HOLD_EXTEND && nStop) {
    let currLine = extendInfo.line;
    if (!currLine.stops.has(nStop) || (nStop == currLine.path[0] && extendInfo.stop == currLine.path[currLine.path.length - 1] || nStop == currLine.path[currLine.path.length - 1] && extendInfo.stop == currLine.path[0]) && currLine.path.length > 2 && !currLine.loopingQ) {
      let newConn = {
        from: extendInfo.stop,
        to: nStop,
        lineID: currLine.lineID,
        colour: currLine.colour
      };
      connections.push(newConn);
      typesOnLine[currLine.lineID].add(nStop.type);
      nStop.linesServed.add(currLine.lineID);
      currLine.stops.add(nStop);
      if (currLine.path[currLine.path.length - 1] == extendInfo.stop)
        currLine.path.push(nStop);
      else
        currLine.path.splice(0, 0, nStop);
      if (currLine.path[0] == currLine.path[currLine.path.length - 1]) {
        currLine.loopingQ = true;
        extendInfo = null;
        recalculateLineConnections();
        routeConfirm();
      }
      recalculateLineConnections();
      for (let pass2 of passengers)
        handlePassenger(pass2);
      if (extendInfo)
        extendInfo.stop = nStop;
    }
  } else if (holdState == K.HOLD_TRAIN) {
    modifyingTrain.x = currPos_canv.x;
    modifyingTrain.y = currPos_canv.y;
    if (nConn && !nConn.pendingRemove) {
      let dist = pDist(currPos_canv.x, currPos_canv.y, nConn.from.x, nConn.from.y, nConn.to.x, nConn.to.y);
      let angBtw = Math.atan2(nConn.from.y - nConn.to.y, nConn.from.x - nConn.to.x);
      modifyingTrain.x += Math.cos(angBtw + K.PI / 2) * dist;
      modifyingTrain.y += Math.sin(angBtw + K.PI / 2) * dist;
      if (pDist(modifyingTrain.x, modifyingTrain.y, nConn.from.x, nConn.from.y, nConn.to.x, nConn.to.y) > 1) {
        modifyingTrain.x = currPos_canv.x + Math.cos(angBtw - K.PI / 2) * dist;
        modifyingTrain.y = currPos_canv.y + Math.sin(angBtw - K.PI / 2) * dist;
      }
      if (modifyingTrain.lineID >= 0) {
        let currLine = lines[modifyingTrain.lineID];
        for (let i = 0; i < currLine.trains.length; i++) {
          if (currLine.trains[i] == modifyingTrain) {
            currLine.trains.splice(i, 1);
            break;
          }
        }
      }
      lines[nConn.lineID].trains.push(modifyingTrain);
      modifyingTrain.lineID = nConn.lineID;
      modifyingTrain.from = nConn.from;
      modifyingTrain.to = nConn.to;
      modifyingTrain.startTime = timeNow();
    } else
      modifyingTrain.pendingMove = true;
    redraw();
  } else if (nStop) {
    let terms = terminals(nStop);
    if (terms && holdState == K.NOHOLD && (!activeSettingsDialog || activeSettingsDialog.stop != nStop)) {
      activeSettingsDialog = {
        stop: nStop,
        time: Date.now() + 50,
        hgt: K.SETTINGSHEIGHT * terms.length,
        lines: terms,
        selected: null
      };
      redraw();
    }
    if (terms)
      rmSettings = false;
    hovering = nStop;
    if (activeSettingsDialog)
      activeSettingsDialog.selected = null;
    document.body.style.cursor = "pointer";
  } else {
    let setSelected = false;
    for (let stop of stops) {
      if (activeSettingsDialog && currPos_canv.x < stop.x + acceptRadius && currPos_canv.x > stop.x - acceptRadius && currPos_canv.y < stop.y + acceptRadius && currPos_canv.y > stop.y - activeSettingsDialog.hgt - acceptRadius) {
        rmSettings = false;
        let dy = (currPos_canv.y - (stop.y - acceptRadius - activeSettingsDialog.hgt)) / K.SETTINGSHEIGHT;
        let activeSel = activeSettingsDialog.lines.length - Math.floor(dy) - 1;
        activeSettingsDialog.selected = activeSel < 0 ? null : activeSettingsDialog.lines[activeSel].lineID;
        if (activeSettingsDialog.selected != null)
          setSelected = true;
        document.body.style.cursor = "pointer";
      }
    }
    if (!setSelected && activeSettingsDialog)
      activeSettingsDialog.selected = null;
    let nTrain = nearestTrain(currPos_canv.x, currPos_canv.y, K.LINEACCEPTDIST);
    if (holdState == K.NOHOLD && rmSettings && nTrain) {
      hoveringTrain = nTrain;
      document.body.style.cursor = "pointer";
    }
    if (rmSettings && nConn && holdState == K.NOHOLD) {
      hoveringConn = nConn;
      document.body.style.cursor = "pointer";
    } else if (rmSettings && holdState == K.NOHOLD && !hoveringTrain)
      document.body.style.cursor = "";
  }
  if (rmSettings) {
    activeSettingsDialog = null;
  }
  redraw();
}
function routeConfirm(ev) {
  extendInfo = null;
  document.body.style.cursor = holdState == K.HOLD ? "grab" : "";
  if (currPath.length > 1) {
    let currCol = getCSSProp("--system-" + colours[0]);
    colours.shift();
    for (let i = 1; i < currPath.length; i++) {
      connections.push({
        from: currPath[i - 1],
        to: currPath[i],
        colour: currCol,
        lineID: lineCt
      });
    }
    let currLine = [];
    let stopsOnLine = /* @__PURE__ */ new Set();
    for (const e of currPath) {
      currLine.push(e);
      stopsOnLine.add(e);
    }
    let currLine2 = {
      lineID: lineCt,
      path: currLine,
      colour: currCol,
      stops: stopsOnLine,
      loopingQ: currPath[0] == currPath[currPath.length - 1],
      trains: []
    };
    lines.push(currLine2);
    let supportedTypes = /* @__PURE__ */ new Set();
    for (let i = 0; i < currPath.length; i++) {
      supportedTypes.add(currPath[i].type);
      currPath[i].linesServed.add(lineCt);
    }
    typesOnLine.push(supportedTypes);
    recalculateLineConnections();
    for (pass of passengers) {
      handlePassenger(pass);
    }
    let t1 = {
      x: currPath[0].x,
      y: currPath[0].y,
      from: currPath[0],
      to: currPath[1],
      lineID: lineCt,
      colour: currCol,
      startT: timeNow(),
      status: K.MOVING,
      passengers: [],
      cap: 6,
      revDir: false,
      percentCovered: 0,
      pendingMove: false
    };
    trains.push(t1);
    currLine2.trains = [t1];
    lineCt++;
  }
  if (holdState == K.HOLD_TRAIN) {
    if (!nearestConnection(currPos_canv.x, currPos_canv.y)) {
      modifyingTrain.pendingRemove = true;
      if (modifyingTrain.passengers.length == 0) {
        trains.splice(trains.indexOf(modifyingTrain), 1);
      }
    }
    for (let pass2 of modifyingTrain.passengers) {
      pass2.stop = modifyingTrain.dropOffLocation;
      pass2.actionStatus = K.REBOARDREQUIRED;
    }
    modifyingTrain.moving = false;
    handleAwaiting(modifyingTrain, modifyingTrain.dropOffLocation);
    modifyingTrain = null;
    holdState = K.NOHOLD;
  }
  holdState = K.NOHOLD;
  currPath = [];
  redraw();
  if (!ev || !downPt || distBtw({ x: ev.clientX, y: ev.clientY }, downPt) > 10)
    return;
  ctx.beginPath();
}
function onWheel(ev) {
  let sclFac = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
  if (sclFac * totalScaleFac > maxSclFac)
    sclFac = maxSclFac / totalScaleFac;
  if (sclFac * totalScaleFac < minSclFac)
    sclFac = minSclFac / totalScaleFac;
  translate(-ev.clientX, -ev.clientY);
  scale(sclFac);
  translate(ev.clientX, ev.clientY);
  totalScaleFac *= sclFac;
  redraw();
}
function pointerdown(ev) {
  if (ev.button != 0)
    return;
  holdState = K.HOLD;
  downPt = { x: ev.clientX, y: ev.clientY };
  let actualPos = fromCanvPos(ev.clientX, ev.clientY);
  let nStop = nearestStop(actualPos, acceptRadius);
  let nConn = nearestConnection(actualPos.x, actualPos.y);
  let nTrain = nearestTrain(actualPos.x, actualPos.y, K.LINEACCEPTDIST);
  if (nStop && lines.length < linesAvailable) {
    holdState = K.HOLD_NEWLINE;
    activeSettingsDialog = null;
    currPath = [nStop];
    redraw();
  } else if (activeSettingsDialog && activeSettingsDialog.selected != null) {
    let sel = activeSettingsDialog.selected;
    holdState = K.HOLD_EXTEND;
    extendInfo = { line: lines[sel], stop: activeSettingsDialog.stop };
    activeSettingsDialog = null;
  } else if (nTrain) {
    holdState = K.HOLD_TRAIN;
    modifyingTrain = nTrain;
    nTrain.pendingMove = true;
    nTrain.moving = true;
    document.body.style.cursor = "grabbing";
    nTrain.dropOffLocation = nTrain.from;
  } else if (nConn) {
    holdState = K.HOLD_CONNECTION;
    modifyingConn = nConn;
  }
  if (holdState == K.HOLD || holdState == K.HOLD_CONNECTION) {
    document.body.style.cursor = "grabbing";
  }
}
function addTrain(ev) {
  holdState = K.HOLD_ADDTRAIN;
  onmove(ev);
  ev.preventDefault();
}
//# sourceMappingURL=events.js.map
