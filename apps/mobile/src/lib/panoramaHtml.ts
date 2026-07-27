/**
 * Builds a self-contained HTML page that renders an equirectangular panorama with
 * Three.js, loaded into a WebView. Native Three.js-in-React-Native (via expo-gl) adds
 * a heavy native dependency for one screen; a WebView with CDN Three.js gets the same
 * drag/pinch-zoom panorama experience with far less native surface area, and is the
 * same rendering technique the web app's viewer uses.
 */
export function buildPanoramaHtml(imageUrl: string, backgroundColor = '#0A141C'): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body { margin: 0; padding: 0; overflow: hidden; background: ${backgroundColor}; height: 100%; }
    #loading {
      position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      color: #7E8F9C; font-family: -apple-system, sans-serif; font-size: 13px;
    }
    canvas { touch-action: none; }
  </style>
</head>
<body>
  <div id="loading">Loading panorama…</div>
  <script src="https://unpkg.com/three@0.169.0/build/three.min.js"></script>
  <script>
    var camera, scene, renderer;
    var lon = 0, lat = 0, onPointerDownLon = 0, onPointerDownLat = 0, onPointerDownX = 0, onPointerDownY = 0, isDown = false;

    init();
    animate();

    function init() {
      var width = window.innerWidth, height = window.innerHeight;
      camera = new THREE.PerspectiveCamera(75, width / height, 1, 1100);
      scene = new THREE.Scene();

      var geometry = new THREE.SphereGeometry(500, 60, 40);
      geometry.scale(-1, 1, 1);

      var material = new THREE.MeshBasicMaterial({ color: 0x182631 });
      var mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      var loader = new THREE.TextureLoader();
      loader.load('${imageUrl}', function (texture) {
        material.map = texture;
        material.needsUpdate = true;
        document.getElementById('loading').style.display = 'none';
      }, undefined, function () {
        document.getElementById('loading').textContent = 'Could not load panorama image.';
      });

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(width, height);
      document.body.appendChild(renderer.domElement);

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('resize', onResize);

      // Two-finger pinch to zoom (touch devices don't fire wheel events).
      var pinchStartDist = null, pinchStartFov = 75;
      renderer.domElement.addEventListener('touchstart', function (e) {
        if (e.touches.length === 2) {
          pinchStartDist = touchDist(e.touches);
          pinchStartFov = camera.fov;
        }
      }, { passive: true });
      renderer.domElement.addEventListener('touchmove', function (e) {
        if (e.touches.length === 2 && pinchStartDist) {
          var dist = touchDist(e.touches);
          var scale = pinchStartDist / dist;
          camera.fov = Math.min(100, Math.max(20, pinchStartFov * scale));
          camera.updateProjectionMatrix();
        }
      }, { passive: true });
      function touchDist(touches) {
        var dx = touches[0].clientX - touches[1].clientX;
        var dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }
    }

    function onPointerDown(e) {
      if (e.pointerType === 'touch' && e.isPrimary === false) return;
      isDown = true;
      onPointerDownX = e.clientX;
      onPointerDownY = e.clientY;
      onPointerDownLon = lon;
      onPointerDownLat = lat;
    }
    function onPointerMove(e) {
      if (!isDown) return;
      lon = (onPointerDownX - e.clientX) * 0.15 + onPointerDownLon;
      lat = (e.clientY - onPointerDownY) * 0.15 + onPointerDownLat;
    }
    function onPointerUp() { isDown = false; }
    function onWheel(e) {
      e.preventDefault();
      camera.fov = Math.min(100, Math.max(20, camera.fov + e.deltaY * 0.04));
      camera.updateProjectionMatrix();
    }
    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }

    function animate() {
      requestAnimationFrame(animate);
      lat = Math.max(-85, Math.min(85, lat));
      var phi = THREE.MathUtils.degToRad(90 - lat);
      var theta = THREE.MathUtils.degToRad(lon);
      var target = new THREE.Vector3(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta)
      );
      camera.lookAt(target);
      renderer.render(scene, camera);
    }
  </script>
</body>
</html>`;
}
