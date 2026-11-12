import styles from './castePlate.module.css'

const CASTE_TITLE = 'современные касты'

/** Лекция «Современные касты». Латинская C в проде («Cовременные») тоже подходит. */
export function isCastePlateTitle(title: string): boolean {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/c/g, 'с')
  return normalized === CASTE_TITLE
}

export function CastePlate() {
  return (
    <article className={styles.plate}>
      <p className={styles.kicker}>Карта миров · таблица 1</p>
      <h2 className={styles.title}>
        Уровни развития сознания.
        <br />
        Современные касты
      </h2>
      <p className={styles.lead}>
        Четыре варны — четыре стихии, четыре сенсора, четыре точки сборки.
      </p>
      <hr className={styles.rule} />

      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Сводка осей</h3>
        <div className={styles.scroll}>
          <table className={styles.axes}>
            <thead>
              <tr>
                <th className={styles.who}>Уровень · каста</th>
                <th>Стихия</th>
                <th>Сенсор</th>
                <th>Осознавание</th>
                <th>Точка сборки</th>
              </tr>
            </thead>
            <tbody>
              <tr className={styles.toneI}>
                <th scope="row">
                  <div className={styles.rank}>
                    <b>I</b>
                    <span>
                      Земледелец,
                      <br />
                      работник |
                      <br />
                      житель
                    </span>
                  </div>
                </th>
                <td>земля</td>
                <td>ощущение</td>
                <td>бессознательное</td>
                <td>тело</td>
              </tr>
              <tr className={styles.toneIi}>
                <th scope="row">
                  <div className={styles.rank}>
                    <b>II</b>
                    <span>
                      Торговец,
                      <br />
                      купец | людина
                    </span>
                  </div>
                </th>
                <td>вода</td>
                <td>эмоция</td>
                <td>подсознание</td>
                <td>тело-душа</td>
              </tr>
              <tr className={styles.toneIii}>
                <th scope="row">
                  <div className={styles.rank}>
                    <b>III</b>
                    <span>
                      Воин |
                      <br />
                      человек
                    </span>
                  </div>
                </th>
                <td>огонь</td>
                <td>воля</td>
                <td>сознание</td>
                <td>душа-дух</td>
              </tr>
              <tr className={styles.toneIv}>
                <th scope="row">
                  <div className={styles.rank}>
                    <b>IV</b>
                    <span>Маг | Аз</span>
                  </div>
                </th>
                <td>воздух</td>
                <td>хер</td>
                <td>сверхсознание</td>
                <td>дух</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Матрица уровней</h3>
        <div className={styles.scroll}>
          <table className={styles.matrix}>
            <thead>
              <tr>
                <th className={styles.stub} />
                <th className={`${styles.lvl} ${styles.toneI}`} scope="col">
                  <b>I</b>
                  <strong>Работяга / житель</strong>
                  <em>земля · ощущение · тело</em>
                </th>
                <th className={`${styles.lvl} ${styles.toneIi}`} scope="col">
                  <b>II</b>
                  <strong>Торговец / людина</strong>
                  <em>вода · эмоция · тело-душа</em>
                </th>
                <th className={`${styles.lvl} ${styles.toneIii}`} scope="col">
                  <b>III</b>
                  <strong>Воин / человек</strong>
                  <em>огонь · воля · душа-дух</em>
                </th>
                <th className={`${styles.lvl} ${styles.toneIv}`} scope="col">
                  <b>IV</b>
                  <strong>Маг / Аз</strong>
                  <em>воздух · хер · дух</em>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className={styles.stub} scope="row">Ось</th>
                <td>земля · ощущение · тело</td>
                <td>вода · эмоция · тело-душа</td>
                <td>огонь · воля · душа-дух</td>
                <td>воздух · хер · дух</td>
              </tr>
              <tr>
                <th className={styles.stub} scope="row">Ценности</th>
                <td>Место жительства; витальные выживание, размножение</td>
                <td>Наслаждение, деньги, социальные связи</td>
                <td>Развитие и освобождение сознания, узнавание себя и мира через углубление в деятельность. Выход из автоматических сценариев</td>
                <td>Знание, творение</td>
              </tr>
              <tr>
                <th className={styles.stub} scope="row">Отношение к судьбе</th>
                <td>Всё происходит случайно, или по воле бога, или от тех, кто наверху. От него не зависит</td>
                <td>Живёт по готовым алгоритмам судьбы. К случайности относится с опаской и одновременно надеется на неё</td>
                <td>Ничего не случайно, у всего есть причина и следствие. Изучение этих связей и совпадений. Переработка судьбоносных программ</td>
                <td>Создаёт событийный ряд</td>
              </tr>
              <tr>
                <th className={styles.stub} scope="row">Осознавание</th>
                <td>Бессознательное</td>
                <td>Подсознание</td>
                <td>Осознание, социальное сознание</td>
                <td>Сверхсознание</td>
              </tr>
              <tr>
                <th className={styles.stub} scope="row">Отношение к боли</th>
                <td>Страх и непринятие</td>
                <td>Избегание. Создание комфортных условий проживания. Отгораживание себя от того, что неудобно и неприятно</td>
                <td>Процесс принятия и преобразования боли. Ответственность за чувства</td>
                <td>Совмещение любви и боли</td>
              </tr>
              <tr>
                <th className={styles.stub} scope="row">Отношение к деньгам</th>
                <td>Деньги нужны для выживания</td>
                <td>Мерило успеха. Выражение собственной значимости. С деньгами связаны как удовольствия, так и страхи. «У всего есть цена в денежном эквиваленте»</td>
                <td>Деньги — инструмент реализации идеи. Может быть как очень много денег, так и мало, в зависимости от задач человека в данный момент</td>
                <td>Создание ценностей, управление денежными потоками</td>
              </tr>
              <tr>
                <th className={styles.stub} scope="row">Задачи</th>
                <td>Научиться заботиться о себе, удовлетворять базовые потребности тела</td>
                <td>Получить разнообразный чувственный опыт, наслаждения, научиться добывать для этого ресурсы</td>
                <td>Узнать свою уникальность и проявить её в мире. Обретение внутренней силы и умения управлять своим состоянием</td>
                <td>Балансировка и повышение уровня гармонии общества. Прямой контакт с высшими силами</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </article>
  )
}
