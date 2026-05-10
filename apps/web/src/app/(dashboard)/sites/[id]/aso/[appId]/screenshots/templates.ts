/** Pre-designed screenshot templates. */
export interface Template {
  id: string;
  name: string;
  gradient?: string;       // CSS gradient — for type="gradient"
  solid?: string;          // Hex color — for type="solid" (Media Markt-style)
  textColor: string;
  hookFontSize: number;
  textPosition: 'top' | 'bottom';
}

export const TEMPLATES: Template[] = [
  // === BOLD SOLID (Media Markt-style) ===
  { id: 'bold-red',     name: 'Bold Red',     solid: '#E20613', textColor: '#ffffff', hookFontSize: 130, textPosition: 'top' },
  { id: 'bold-orange',  name: 'Bold Orange',  solid: '#FF6B00', textColor: '#ffffff', hookFontSize: 130, textPosition: 'top' },
  { id: 'bold-yellow',  name: 'Bold Yellow',  solid: '#FFC700', textColor: '#1a1a1a', hookFontSize: 130, textPosition: 'top' },
  { id: 'bold-green',   name: 'Bold Green',   solid: '#00A859', textColor: '#ffffff', hookFontSize: 130, textPosition: 'top' },
  { id: 'bold-blue',    name: 'Bold Blue',    solid: '#1976D2', textColor: '#ffffff', hookFontSize: 130, textPosition: 'top' },
  { id: 'bold-purple',  name: 'Bold Purple',  solid: '#7B1FA2', textColor: '#ffffff', hookFontSize: 130, textPosition: 'top' },
  { id: 'bold-pink',    name: 'Bold Pink',    solid: '#E91E63', textColor: '#ffffff', hookFontSize: 130, textPosition: 'top' },
  { id: 'bold-black',   name: 'Bold Black',   solid: '#0a0a0a', textColor: '#ffffff', hookFontSize: 130, textPosition: 'top' },

  // === GRADIENT (Apple-style polished) ===
  { id: 'apple-clean',      name: 'Apple Clean',     gradient: 'linear-gradient(180deg, #f5f5f7 0%, #e8e8ed 100%)', textColor: '#1d1d1f', hookFontSize: 100, textPosition: 'top' },
  { id: 'midnight',         name: 'Midnight',        gradient: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)', textColor: '#ffffff', hookFontSize: 110, textPosition: 'top' },
  { id: 'sunset',           name: 'Sunset',          gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', textColor: '#ffffff', hookFontSize: 100, textPosition: 'top' },
  { id: 'ocean',            name: 'Ocean',           gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', textColor: '#ffffff', hookFontSize: 100, textPosition: 'bottom' },
  { id: 'lush',             name: 'Lush',            gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', textColor: '#1a1a1a', hookFontSize: 100, textPosition: 'top' },
  { id: 'royal-purple',     name: 'Royal Purple',    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', textColor: '#ffffff', hookFontSize: 110, textPosition: 'top' },
  { id: 'cosmic',           name: 'Cosmic',          gradient: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', textColor: '#ffffff', hookFontSize: 110, textPosition: 'top' },
  { id: 'flamingo',         name: 'Flamingo',        gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', textColor: '#ffffff', hookFontSize: 100, textPosition: 'top' },
  { id: 'graphite',         name: 'Graphite',        gradient: 'linear-gradient(135deg, #232526 0%, #414345 100%)', textColor: '#ffffff', hookFontSize: 110, textPosition: 'top' },
];
