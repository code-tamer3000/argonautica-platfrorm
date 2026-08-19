import { IconCompass } from '../../components/icons'
import styles from './chat.module.css'

/**
 * Плашка вместо композера у выпускника (user.graduated_at): экспедиция пройдена,
 * вся история комнат остаётся на месте, но писать больше нельзя. Занимает то же
 * место, что и композер, — лента не прыгает. Бэкенд эти пути всё равно закрывает
 * (403 с тем же текстом, см. app/services/graduation.py); это не защита, а ответ
 * на вопрос «почему я не могу написать».
 */
export function GraduatedNotice({ text = 'Аргонавт, ты прошёл Экспедицию' }: { text?: string }) {
  return (
    <div className={styles.graduatedNotice}>
      <span className={styles.graduatedIcon} aria-hidden>
        <IconCompass size={18} />
      </span>
      <span>{text}</span>
    </div>
  )
}
