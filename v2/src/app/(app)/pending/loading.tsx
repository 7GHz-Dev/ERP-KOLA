/**
 * โครงหน้าที่แสดงทันทีระหว่างรอข้อมูล
 *
 * Next.js สลับมาหน้านี้ทันทีที่กดลิงก์ ผู้ใช้จึงเห็นการตอบสนองทันที
 * ไม่ต้องนั่งมองหน้าเดิมค้างจนกว่าข้อมูลจะมา ซึ่งเป็นสาเหตุที่รู้สึกว่า "ช้า"
 */
export default function Loading() {
  return (
    <>
      <div className="page-head">
        <h1>งานคงค้าง</h1>
        <p>กำลังโหลด...</p>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="col-no">No.</th>
              {Array.from({ length: 7 }).map((_, i) => (
                <th key={i}>
                  <span className="skeleton skeleton-head" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, r) => (
              <tr key={r}>
                <td>{r + 1}</td>
                {Array.from({ length: 7 }).map((_, c) => (
                  <td key={c}>
                    <span className="skeleton" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
