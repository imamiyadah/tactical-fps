// physics.js — movement collision and ray tests against the map's axis
// aligned boxes. Everything is allocation-free: results are written into
// caller-owned objects so the hot loops never create garbage.
//
// A collider is { minX, minY, minZ, maxX, maxY, maxZ }.

// Move a circle (x/z, radius r) by (dx, dz), sliding along boxes whose
// vertical span overlaps the body's [y, y + height]. Returns nothing; the
// position is updated in place. Axis-separated resolution keeps sliding
// smooth along walls and container faces.
export function moveAndCollide(pos, dx, dz, radius, height, colliders) {
  const y0 = pos.y, y1 = pos.y + height;
  pos.x += dx;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.minY >= y1 || c.maxY <= y0) continue;
    if (pos.x + radius > c.minX && pos.x - radius < c.maxX &&
        pos.z + radius > c.minZ && pos.z - radius < c.maxZ) {
      pos.x = dx > 0 ? c.minX - radius : c.maxX + radius;
    }
  }
  pos.z += dz;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.minY >= y1 || c.maxY <= y0) continue;
    if (pos.x + radius > c.minX && pos.x - radius < c.maxX &&
        pos.z + radius > c.minZ && pos.z - radius < c.maxZ) {
      pos.z = dz > 0 ? c.minZ - radius : c.maxZ + radius;
    }
  }
}

// Ray vs the collider list. (ox,oy,oz) origin, (dx,dy,dz) normalised
// direction. Writes the nearest hit distance into out.t and returns true
// when the ray strikes a box within maxDist.
const rayTmp = { t: 0 };
export function rayHitWorld(ox, oy, oz, dx, dy, dz, colliders, maxDist, out) {
  let best = maxDist;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    let tmin = 0, tmax = best;
    // X slab
    if (dx === 0) { if (ox < c.minX || ox > c.maxX) continue; }
    else {
      let t1 = (c.minX - ox) / dx, t2 = (c.maxX - ox) / dx;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // Y slab
    if (dy === 0) { if (oy < c.minY || oy > c.maxY) continue; }
    else {
      let t1 = (c.minY - oy) / dy, t2 = (c.maxY - oy) / dy;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    // Z slab
    if (dz === 0) { if (oz < c.minZ || oz > c.maxZ) continue; }
    else {
      let t1 = (c.minZ - oz) / dz, t2 = (c.maxZ - oz) / dz;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    if (tmin < best && tmin > 0.0001) best = tmin;
  }
  if (best < maxDist) { out.t = best; return true; }
  return false;
}

// True when the straight segment a->b is blocked by any collider. Used for
// bot line-of-sight and grenade blast checks.
export function segmentBlocked(ax, ay, az, bx, by, bz, colliders) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.001) return false;
  const hit = rayHitWorld(ax, ay, az, dx / len, dy / len, dz / len, colliders, len, rayTmp);
  return hit;
}

// Ray vs one AABB given by centre and half extents; returns distance or -1.
export function rayHitBox(ox, oy, oz, dx, dy, dz, cx, cy, cz, hx, hy, hz, maxDist) {
  let tmin = 0, tmax = maxDist;
  if (dx === 0) { if (ox < cx - hx || ox > cx + hx) return -1; }
  else {
    let t1 = (cx - hx - ox) / dx, t2 = (cx + hx - ox) / dx;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (dy === 0) { if (oy < cy - hy || oy > cy + hy) return -1; }
  else {
    let t1 = (cy - hy - oy) / dy, t2 = (cy + hy - oy) / dy;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (dz === 0) { if (oz < cz - hz || oz > cz + hz) return -1; }
  else {
    let t1 = (cz - hz - oz) / dz, t2 = (cz + hz - oz) / dz;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin > 0.0001 ? tmin : -1;
}
