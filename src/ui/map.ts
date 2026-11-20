import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Bundlers break Leaflet's default icon URL detection; use an inline SVG pin instead.
const pin = L.divIcon({
  className: '',
  iconSize: [28, 40],
  iconAnchor: [14, 38],
  html: `<svg width="28" height="40" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg">
    <path d="M14 1C7 1 2 6.2 2 12.6 2 21.6 14 38 14 38s12-16.4 12-25.4C26 6.2 21 1 14 1z" fill="#e0322b" stroke="#fff" stroke-width="2"/>
    <circle cx="14" cy="13" r="4.5" fill="#fff"/></svg>`,
});

export class MapView {
  readonly map: L.Map;
  private marker: L.Marker | null = null;

  constructor(
    container: HTMLElement,
    private onPick: (lat: number, lon: number) => void,
  ) {
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)',
    });
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    });
    this.map = L.map(container, { center: [49.23, 19.98], zoom: 11, layers: [topo], attributionControl: false });
    L.control.layers({ Topograficzna: topo, OpenStreetMap: osm }, {}, { position: 'topright' }).addTo(this.map);
    this.map.on('click', (e: L.LeafletMouseEvent) => this.onPick(e.latlng.lat, e.latlng.lng));
    new ResizeObserver(() => this.map.invalidateSize()).observe(container);
  }

  setObserver(lat: number, lon: number, recenter: boolean) {
    if (!this.marker) {
      this.marker = L.marker([lat, lon], { icon: pin, draggable: true }).addTo(this.map);
      this.marker.on('dragend', () => {
        const p = this.marker!.getLatLng();
        this.onPick(p.lat, p.lng);
      });
    } else {
      this.marker.setLatLng([lat, lon]);
    }
    if (recenter && !this.map.getBounds().contains([lat, lon])) this.map.panTo([lat, lon]);
  }
}
