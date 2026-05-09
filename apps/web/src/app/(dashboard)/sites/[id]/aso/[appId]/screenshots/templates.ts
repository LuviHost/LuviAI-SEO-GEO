/** Pre-designed screenshot templates. */
export interface Template {
  id: string;
  name: string;
  gradient: string;
  textColor: string;
  hookFontSize: number;
  textPosition: 'top' | 'bottom';
}

export const TEMPLATES: Template[] = [
  { id: 'apple-clean',      name: 'Apple Clean',     gradient: 'linear-gradient(180deg, #f5f5f7 0%, #e8e8ed 100%)', textColor: '#1d1d1f', hookFontSize: 96,  textPosition: 'top' },
  { id: 'midnight',         name: 'Midnight',        gradient: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)', textColor: '#ffffff', hookFontSize: 100, textPosition: 'top' },
  { id: 'sunset',           name: 'Sunset',          gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', textColor: '#ffffff', hookFontSize: 96,  textPosition: 'top' },
  { id: 'ocean',            name: 'Ocean',           gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', textColor: '#ffffff', hookFontSize: 92,  textPosition: 'bottom' },
  { id: 'lush',             name: 'Lush',            gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', textColor: '#1a1a1a', hookFontSize: 92,  textPosition: 'top' },
  { id: 'royal-purple',     name: 'Royal Purple',    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', textColor: '#ffffff', hookFontSize: 100, textPosition: 'top' },
  { id: 'cosmic',           name: 'Cosmic',          gradient: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', textColor: '#ffffff', hookFontSize: 100, textPosition: 'top' },
  { id: 'flamingo',         name: 'Flamingo',        gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', textColor: '#ffffff', hookFontSize: 96,  textPosition: 'top' },
  { id: 'dawn',             name: 'Dawn',            gradient: 'linear-gradient(135deg, #ff9a9e 0%, #fad0c4 100%)', textColor: '#1a1a1a', hookFontSize: 92,  textPosition: 'bottom' },
  { id: 'graphite',         name: 'Graphite',        gradient: 'linear-gradient(135deg, #232526 0%, #414345 100%)', textColor: '#ffffff', hookFontSize: 100, textPosition: 'top' },
  { id: 'peach',            name: 'Peach',           gradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)', textColor: '#1a1a1a', hookFontSize: 96,  textPosition: 'top' },
  { id: 'ruby',             name: 'Ruby',            gradient: 'linear-gradient(135deg, #ff0844 0%, #ffb199 100%)', textColor: '#ffffff', hookFontSize: 100, textPosition: 'top' },
];
