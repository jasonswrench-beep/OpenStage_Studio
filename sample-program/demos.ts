// The practice program's demo library: invented lesson plans with made-up titles and original text.
// Nothing here is real course content, and no person is named.

export interface Lesson {
  title: string;
  subject: string;
  minutes: number;
  notes: string;
  checklist: string[];
  shared: boolean;
}

export interface DemoProject {
  name: string;
  label: string;
  lessons: Lesson[];
}

const lesson = (title: string, subject: string, minutes: number, notes = "", checklist: string[] = []): Lesson =>
  ({ title, subject, minutes, notes, checklist, shared: false });

export const DEMO_PROJECTS: DemoProject[] = [
  {
    name: "demo-lessons-01",
    label: "Spring term lessons",
    lessons: [
      lesson("Fractions on a number line", "Mathematics", 45, "Start with halves, then quarters.", ["Number line strips", "Markers"]),
      lesson("How seeds become plants", "Science", 50, "Plant one bean in a clear cup.", ["Clear cups", "Soil", "Beans"]),
      lesson("Writing a friendly letter", "Writing", 40, "Greeting, body, closing.", ["Lined paper"]),
      lesson("Map reading basics", "Geography", 45, "North arrow and the key.", ["Town map handout"]),
      lesson("Rhythm with body percussion", "Music", 30, "Clap, stamp, click.", []),
      lesson("Measuring with a ruler", "Mathematics", 40, "Centimetres first.", ["Rulers"]),
      lesson("The water cycle", "Science", 45, "Draw the cycle as a circle.", ["Poster paper"]),
      lesson("Story openings", "Writing", 35, "Three ways to hook a reader.", []),
      lesson("Shapes all around us", "Mathematics", 30, "Find shapes in the classroom.", []),
      lesson("Weather diary", "Science", 25, "Record the sky each morning.", ["Diary sheets"]),
      lesson("Kind words week", "Wellbeing", 20, "One kind note a day.", []),
      lesson("Patterns in art", "Art", 50, "Repeat, rotate, reflect.", ["Coloured pencils"]),
    ],
  },
  { name: "demo-empty", label: "Empty planner", lessons: [] },
];

export const SUBJECTS = ["Art", "Geography", "Mathematics", "Music", "Science", "Wellbeing", "Writing"];
export const LENGTHS = [20, 25, 30, 35, 40, 45, 50, 60];
