import {
  BookOpen,
  Clapperboard,
  FileText,
  FolderGit2,
  Gamepad2,
  GraduationCap,
  Plane,
  Salad,
  ShoppingBag,
  UserRound,
  Utensils,
  Star,
  Heart,
  Music,
  Dumbbell,
  Briefcase,
  type LucideIcon,
} from 'lucide-react';

/** 类型图标名 → lucide 组件。自定义类型可选这些。 */
export const TYPE_ICONS: Record<string, LucideIcon> = {
  'file-text': FileText,
  clapperboard: Clapperboard,
  'gamepad-2': Gamepad2,
  'book-open': BookOpen,
  'folder-git-2': FolderGit2,
  'graduation-cap': GraduationCap,
  plane: Plane,
  'shopping-bag': ShoppingBag,
  utensils: Utensils,
  salad: Salad,
  'user-round': UserRound,
  star: Star,
  heart: Heart,
  music: Music,
  dumbbell: Dumbbell,
  briefcase: Briefcase,
};

export function typeIcon(name: string | undefined): LucideIcon {
  return (name && TYPE_ICONS[name]) || FileText;
}
